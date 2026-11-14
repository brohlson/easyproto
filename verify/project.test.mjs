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
  const unsupported = JSON.stringify({ ...pointer, schemaVersion: 3 });
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
  project.copyArtboard(original.id, clipboardId);
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
