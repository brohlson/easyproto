import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Project } from "../dist/project.js";

const args = { name: "New", width: 320, height: 180, x: 23, y: 45, html: "<main>Saved</main>", css: "body{color:red}" };
const command = (projectId) => ({ projectId, commandId: randomUUID(), expectedRevision: 0, operation: "create_artboard", arguments: args });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "easy-proto-storage-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const folder = join(root, "Project");
  return { root, folder, project: await Project.open(folder) };
}

test("simultaneous edits, failed save and unsupported schema preserve the authoritative revision", async (t) => {
  const { project, folder, root } = await fixture(t);
  const first = command(project.snapshot.manifest.projectId);
  assert.throws(() => project.execute({ ...first, arguments: { ...args, html: "\uD800" } }), /valid Unicode/);
  const [saved, rejected] = await Promise.allSettled([project.execute(first), project.execute(command(first.projectId))]);
  assert.equal(saved.value.revision, 1);
  assert.equal(rejected.reason.code, "REVISION_CONFLICT");
  const managed = join(folder, ".easy-proto");
  const backup = managed + "-backup";
  await rename(managed, backup);
  await writeFile(managed, "");
  await assert.rejects(project.execute({ ...command(first.projectId), expectedRevision: 1 }), { code: "SAVE_FAILED" });
  assert.equal(project.snapshot.manifest.revision, 1);
  await rm(managed);
  await rename(backup, managed);
  const reopened = await Project.open(folder);
  assert.deepEqual(await reopened.execute(first), saved.value);
  const pointerPath = join(folder, "project.json");
  const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  const unsupported = JSON.stringify({ ...pointer, schemaVersion: 2 });
  await writeFile(pointerPath, unsupported);
  await assert.rejects(Project.open(folder));
  assert.equal(await readFile(pointerPath, "utf8"), unsupported);
  await rename(pointerPath, join(root, "pointer-backup"));
  await assert.rejects(Project.open(folder), /revision data remains/);
});

async function killAt(folder, input, phase) {
  const imported = new URL("../dist/project.js", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import {Project} from ${JSON.stringify(imported)};
    const project = await Project.open(process.argv[1], (phase) => {
      if (phase === process.argv[3]) process.kill(process.pid, "SIGKILL");
    });
    await project.execute(JSON.parse(process.argv[2]));
  `, folder, JSON.stringify(input), phase], { stdio: ["ignore", "ignore", "inherit"] });
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
  assert.deepEqual(after.snapshot.sources.get(after.snapshot.manifest.artboards[1].id), { html: args.html, css: args.css });
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
