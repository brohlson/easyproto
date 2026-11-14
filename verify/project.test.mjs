import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Project } from "../dist/project.js";

const args = {
  name: "New",
  width: 320,
  height: 180,
  x: 23,
  y: 45,
  html: "<main>Saved</main>",
  css: "body{color:red}",
};
const command = (projectId) => ({
  projectId,
  commandId: randomUUID(),
  expectedRevision: 0,
  operation: "create_artboard",
  arguments: args,
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "easy-proto-storage-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const folder = join(root, "Project");
  return { root, folder, project: await Project.open(folder) };
}

test("simultaneous edits, failed save and unsupported schema preserve the authoritative revision", async (t) => {
  const { project, folder, root } = await fixture(t);
  const first = command(project.snapshot.manifest.projectId);
  assert.throws(
    () => project.execute({ ...first, arguments: { ...args, html: "\uD800" } }),
    /valid Unicode/,
  );
  const [saved, rejected] = await Promise.allSettled([
    project.execute(first),
    project.execute(command(first.projectId)),
  ]);
  assert.equal(saved.value.revision, 1);
  assert.equal(rejected.reason.code, "REVISION_CONFLICT");
  const managed = join(folder, ".easy-proto");
  const backup = managed + "-backup";
  await rename(managed, backup);
  await writeFile(managed, "");
  await assert.rejects(project.execute({ ...command(first.projectId), expectedRevision: 1 }), {
    code: "SAVE_FAILED",
  });
  assert.equal(project.snapshot.manifest.revision, 1);
  await rm(managed);
  await rename(backup, managed);
  const reopened = await Project.open(folder);
  assert.deepEqual(await reopened.execute(first), saved.value);
  const pointerPath = join(folder, "project.json");
  const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  const unsupported = JSON.stringify({ ...pointer, schemaVersion: 4 });
  await writeFile(pointerPath, unsupported);
  await assert.rejects(Project.open(folder));
  assert.equal(await readFile(pointerPath, "utf8"), unsupported);
  await rename(pointerPath, join(root, "pointer-backup"));
  await assert.rejects(Project.open(folder), /revision data remains/);
});

async function killAt(folder, input, phase) {
  const imported = new URL("../dist/project.js", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {Project} from ${JSON.stringify(imported)};
    const project = await Project.open(process.argv[1], (phase) => {
      if (phase === process.argv[3]) process.kill(process.pid, "SIGKILL");
    });
    await project.execute(JSON.parse(process.argv[2]));
  `,
      folder,
      JSON.stringify(input),
      phase,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const signal = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (_code, signal) => resolve(signal));
  });
  assert.equal(signal, "SIGKILL");
}

test("kill before and after atomic publication recovers whole revisions and durable retry outcomes", async (t) => {
  const { project, folder, root } = await fixture(t);
  const input = command(project.snapshot.manifest.projectId);
  await killAt(folder, input, "snapshotWritten");
  const before = await Project.open(folder);
  assert.equal(before.snapshot.manifest.revision, 0);
  assert.equal(before.snapshot.manifest.artboards.length, 1);
  await killAt(folder, input, "pointerPublished");
  const moved = join(root, "Portable copy");
  await rename(folder, moved);
  const after = await Project.open(moved);
  assert.equal(after.snapshot.manifest.revision, 1);
  assert.equal(after.snapshot.manifest.artboards.length, 2);
  assert.deepEqual(after.snapshot.sources.get(after.snapshot.manifest.artboards[1].id), {
    html: args.html,
    css: args.css,
  });
  assert.deepEqual(await after.execute(input), after.snapshot.manifest.commands[0].result);
  assert.equal(after.snapshot.manifest.revision, 1);
});

test("portable assets are snapshotted per open and symbolic or hard links are refused", async (t) => {
  const { project, folder, root } = await fixture(t);
  const assets = join(folder, "assets");
  const outside = join(root, "outside.png");
  await mkdir(assets);
  await writeFile(outside, "synthetic outside data");
  await symlink(outside, join(assets, "outside.png"));
  await assert.rejects(Project.open(folder), /cannot contain symbolic links/);
  await rm(join(assets, "outside.png"));
  await link(outside, join(assets, "outside.png"));
  await assert.rejects(Project.open(folder), /single-link project file/);
  await rm(join(assets, "outside.png"));
  await writeFile(join(assets, "local.png"), "synthetic inside data");
  const reopened = await Project.open(folder);
  assert.notEqual(reopened.assetDigest, project.assetDigest);
  assert.equal(reopened.assets.get("local.png").bytes.toString(), "synthetic inside data");
  await writeFile(join(assets, "local.png"), "changed on disk");
  assert.equal(reopened.assets.get("local.png").bytes.toString(), "synthetic inside data");
  const pointer = JSON.parse(await readFile(join(folder, "project.json"), "utf8"));
  const board = reopened.snapshot.manifest.artboards[0];
  const managedSource = join(folder, ".easy-proto", pointer.snapshot, board.htmlRef);
  await link(managedSource, join(root, "hard-linked-source.html"));
  await assert.rejects(Project.open(folder), /single-link project file/);
});

test("project rename preserves the last published name when replacement fails", async (t) => {
  const { project, folder } = await fixture(t);
  await project.rename("Project", "  Current name  ");
  assert.equal(project.name, "Current name");
  await assert.rejects(project.rename("Project", "Stale name"), { code: "NAME_CHANGED" });
  const pointer = await readFile(join(folder, "project.json"), "utf8");
  const name = join(folder, ".easy-proto", "name.json");
  const backup = name + ".backup";
  await rename(name, backup);
  await mkdir(name);
  try {
    await assert.rejects(project.rename("Current name", "Failed name"), { code: "SAVE_FAILED" });
    assert.equal(project.name, "Current name");
    assert.equal(await readFile(join(folder, "project.json"), "utf8"), pointer);
  } finally {
    await rm(name, { recursive: true });
    await rename(backup, name);
  }
  assert.equal((await Project.open(folder)).name, "Current name");
});

test("artboard duplication replays one copy and offsets repeated copies at the canvas limit", async (t) => {
  const { project, folder } = await fixture(t);
  const create = command(project.snapshot.manifest.projectId);
  const { artboard } = await project.execute({
    ...create,
    arguments: { ...args, name: "x".repeat(94) + "😀tail", x: 100_000, y: 100_000 },
  });
  const duplicate = {
    projectId: create.projectId,
    commandId: randomUUID(),
    expectedRevision: 1,
    operation: "duplicate_artboard",
    arguments: { artboardId: artboard.id },
  };
  const saved = await project.execute(duplicate);
  assert.equal(saved.artboard.name, "x".repeat(94) + " copy");
  assert.deepEqual([saved.artboard.x, saved.artboard.y], [99_960, 99_960]);
  assert.notEqual(saved.artboard.id, artboard.id);
  const reopened = await Project.open(folder);
  assert.deepEqual(await reopened.execute(duplicate), saved);
  assert.equal(reopened.snapshot.manifest.artboards.length, 3);
  await assert.rejects(reopened.execute({ ...duplicate, commandId: randomUUID() }), {
    code: "REVISION_CONFLICT",
  });
  const repeated = await reopened.execute({
    ...duplicate,
    commandId: randomUUID(),
    expectedRevision: saved.revision,
  });
  assert.deepEqual([repeated.artboard.x, repeated.artboard.y], [99_920, 99_920]);
});

test("copy freezes its source and undo preserves saved revisions and command retries", async (t) => {
  const { project, folder } = await fixture(t);
  const {
    projectId,
    artboards: [original],
  } = project.snapshot.manifest;
  const clipboardId = randomUUID();
  const before = project.snapshot.sources.get(original.id);
  project.copyArtboards([original.id], clipboardId);
  const run = (operation, args = {}) => ({
    projectId,
    commandId: randomUUID(),
    expectedRevision: project.snapshot.manifest.revision,
    operation,
    arguments: args,
  });
  await project.execute(
    run("update_artboard", { artboardId: original.id, patch: { html: "<h1>Later</h1>" } }),
  );
  const paste = run("paste_artboard", { clipboardId });
  const copied = await project.execute(paste);
  assert.deepEqual(project.snapshot.sources.get(copied.artboard.id), before);
  assert.equal(project.snapshot.manifest.schemaVersion, 1);
  const undo = run("undo");
  await project.execute(undo);
  assert.equal(project.snapshot.manifest.schemaVersion, 2);
  assert.equal(project.snapshot.sources.has(copied.artboard.id), false);
  const reopened = await Project.open(folder);
  assert.equal(reopened.canUndo, false);
  assert.equal(reopened.canRedo, false);
  assert.deepEqual(await reopened.execute(paste), copied);
  assert.equal(reopened.snapshot.sources.has(copied.artboard.id), false);
  const redo = run("redo");
  const restored = await project.execute(redo);
  assert.equal(restored.artboard.id, copied.artboard.id);
  assert.deepEqual(project.snapshot.sources.get(restored.artboard.id), before);
  await project.execute(run("undo"));
  await project.execute(run("undo"));
  assert.deepEqual(project.snapshot.sources.get(original.id), before);
  assert.equal(project.canRedo, true);
  await project.execute(run("update_artboard", { artboardId: original.id, patch: { x: 20 } }));
  assert.equal(project.canRedo, false);
  await assert.rejects(project.execute(run("redo")), { code: "HISTORY_EMPTY" });
});

test("artboard deletion survives reopening and undo restores the original artboard order", async (t) => {
  const { project, folder } = await fixture(t);
  const {
    projectId,
    artboards: [original],
  } = project.snapshot.manifest;
  const originalSource = project.snapshot.sources.get(original.id);
  const add = command(projectId);
  const { artboard: neighbor } = await project.execute(add);
  const remove = {
    projectId,
    commandId: randomUUID(),
    expectedRevision: 1,
    operation: "delete_artboard",
    arguments: { artboardId: original.id },
  };
  const deleted = await project.execute(remove);
  const reopened = await Project.open(folder);
  assert.deepEqual(reopened.snapshot.manifest.artboards, [neighbor]);
  assert.equal(reopened.snapshot.sources.has(original.id), false);
  assert.deepEqual(await reopened.execute(remove), deleted);

  const restored = await project.execute({
    projectId,
    commandId: randomUUID(),
    expectedRevision: deleted.revision,
    operation: "undo",
    arguments: {},
  });
  assert.deepEqual(project.snapshot.manifest.artboards, [
    { ...original, sourceRevision: restored.revision },
    neighbor,
  ]);
  assert.deepEqual(project.snapshot.sources.get(original.id), originalSource);
  await project.execute({
    projectId,
    commandId: randomUUID(),
    expectedRevision: restored.revision,
    operation: "redo",
    arguments: {},
  });
  assert.deepEqual((await Project.open(folder)).snapshot.manifest.artboards, [neighbor]);
});

test("group edits are atomic, undo in one step, and replay complete results after reopening", async (t) => {
  const { project, folder } = await fixture(t);
  const projectId = project.snapshot.manifest.projectId;
  const edit = (operation, args) => ({
    projectId,
    commandId: randomUUID(),
    expectedRevision: project.snapshot.manifest.revision,
    operation,
    arguments: args,
  });
  await project.execute(edit("create_artboard", { ...args, x: 100 }));
  await project.execute(edit("create_artboard", { ...args, x: 200 }));
  const original = project.snapshot.manifest.artboards;
  const selected = [original[0], original[2]];
  const ids = selected.map(({ id }) => id).reverse();
  const missing = edit("delete_artboards", { artboardIds: [...ids, randomUUID()] });
  await assert.rejects(project.execute(missing), { code: "ARTBOARD_NOT_FOUND" });
  assert.deepEqual(project.snapshot.manifest.artboards, original);
  const move = await project.execute(
    edit("move_artboards", { artboardIds: ids, dx: 100_000, dy: 20 }),
  );
  assert.equal(move.revision, 3);
  assert.deepEqual(
    move.artboards.map(({ x, y, sourceRevision }) => [x, y, sourceRevision]),
    selected.map(({ x, y, sourceRevision }) => [x + 99_800, y + 20, sourceRevision]),
  );
  assert.deepEqual(project.snapshot.manifest.artboards[1], original[1]);
  await project.execute(edit("undo", {}));
  assert.deepEqual(project.snapshot.manifest.artboards, original);

  const duplicate = edit("duplicate_artboards", { artboardIds: ids });
  const copies = await project.execute(duplicate);
  assert.equal(copies.artboards.length, 2);
  assert.deepEqual(
    copies.artboards.map(({ x, y }) => [x, y]),
    selected.map(({ x, y }) => [x + 40, y + 40]),
  );
  for (const [index, copy] of copies.artboards.entries()) {
    assert.notEqual(copy.id, selected[index].id);
    assert.deepEqual(
      project.snapshot.sources.get(copy.id),
      project.snapshot.sources.get(selected[index].id),
    );
  }
  await project.execute(edit("undo", {}));
  assert.deepEqual(project.snapshot.manifest.artboards, original);
  const redo = await project.execute(edit("redo", {}));
  assert.deepEqual(
    redo.artboards.map(({ id }) => id),
    copies.artboards.map(({ id }) => id),
  );

  const clipboardId = randomUUID();
  project.copyArtboards(ids, clipboardId);
  const deleted = await project.execute(edit("delete_artboards", { artboardIds: ids }));
  assert.ok(ids.every((id) => !project.snapshot.sources.has(id)));
  await assert.rejects(project.execute({ ...missing, arguments: { artboardIds: ids } }), {
    code: "REVISION_CONFLICT",
  });
  const pasted = await project.execute(edit("paste_artboard", { clipboardId }));
  assert.equal(pasted.artboards.length, 2);
  assert.deepEqual(
    pasted.artboards.map(({ sourceDigest }) => sourceDigest),
    selected.map(({ sourceDigest }) => sourceDigest),
  );
  await project.execute(edit("undo", {}));
  await project.execute(edit("undo", {}));
  assert.deepEqual(
    project.snapshot.manifest.artboards.slice(0, 3).map(({ id }) => id),
    original.map(({ id }) => id),
  );

  await project.execute(edit("delete_artboard", { artboardId: original[1].id }));
  const reopened = await Project.open(folder);
  assert.equal(reopened.snapshot.manifest.schemaVersion, 3);
  assert.deepEqual(reopened.snapshot.manifest.artboards, project.snapshot.manifest.artboards);
  assert.deepEqual(await reopened.execute(duplicate), copies);
  await assert.rejects(
    reopened.execute({ ...duplicate, arguments: { artboardIds: [original[0].id] } }),
    { code: "COMMAND_ID_REUSED" },
  );
  assert.equal(deleted.artboards.length, 2);
});

test("fractional group positions at the canvas limit stay valid across save and retry", async (t) => {
  const { project, folder } = await fixture(t);
  const {
    projectId,
    artboards: [first],
  } = project.snapshot.manifest;
  await project.execute({
    projectId,
    commandId: randomUUID(),
    expectedRevision: 0,
    operation: "update_artboard",
    arguments: { artboardId: first.id, patch: { x: -100_000 } },
  });
  const { artboard: second } = await project.execute({
    ...command(projectId),
    expectedRevision: 1,
    arguments: { ...args, x: -99_999.7 },
  });
  const move = {
    projectId,
    commandId: randomUUID(),
    expectedRevision: 2,
    operation: "move_artboards",
    arguments: { artboardIds: [first.id, second.id], dx: 200_000, dy: 0 },
  };
  await killAt(folder, move, "snapshotWritten");
  const beforePublication = await Project.open(folder);
  assert.equal(beforePublication.snapshot.manifest.schemaVersion, 1);
  assert.equal(beforePublication.snapshot.manifest.revision, 2);
  assert.equal(beforePublication.snapshot.manifest.artboards[1].x, -99_999.7);
  await killAt(folder, move, "pointerPublished");
  const reopened = await Project.open(folder);
  assert.equal(reopened.snapshot.manifest.schemaVersion, 3);
  const committed = await reopened.execute(move);
  assert.equal(committed.revision, 3);
  assert.equal(committed.artboards[1].x, 100_000);
  assert.ok(Math.abs(committed.artboards[1].x - committed.artboards[0].x - 0.3) < 1e-9);
  assert.deepEqual(reopened.snapshot.manifest.artboards, committed.artboards);
  assert.deepEqual(await reopened.execute(move), committed);
});

test("group duplication finds a smaller offset when a canvas edge blocks the preferred one", async (t) => {
  const { project } = await fixture(t);
  const {
    projectId,
    artboards: [first],
  } = project.snapshot.manifest;
  await project.execute({
    projectId,
    commandId: randomUUID(),
    expectedRevision: 0,
    operation: "update_artboard",
    arguments: { artboardId: first.id, patch: { x: -100_000, y: -100_000 } },
  });
  const { artboard: second } = await project.execute({
    ...command(projectId),
    expectedRevision: 1,
    arguments: { ...args, x: 100_000, y: 99_950 },
  });
  await project.execute({
    ...command(projectId),
    expectedRevision: 2,
    arguments: { ...args, x: 100_000, y: 99_990 },
  });
  const copied = await project.execute({
    projectId,
    commandId: randomUUID(),
    expectedRevision: 3,
    operation: "duplicate_artboards",
    arguments: { artboardIds: [first.id, second.id] },
  });
  const clipboardId = randomUUID();
  project.copyArtboards([first.id, second.id], clipboardId);
  const pasted = await project.execute({
    projectId,
    commandId: randomUUID(),
    expectedRevision: 4,
    operation: "paste_artboard",
    arguments: { clipboardId },
  });
  assert.notEqual(copied.artboards[1].y, pasted.artboards[1].y);
  for (const result of [copied, pasted]) {
    const [a, b] = result.artboards;
    assert.deepEqual([a.x, b.x], [-100_000, 100_000]);
    const offset = b.y - second.y;
    assert.ok(offset > 0 && offset < 40);
    assert.equal(a.y - -100_000, offset);
  }
});
