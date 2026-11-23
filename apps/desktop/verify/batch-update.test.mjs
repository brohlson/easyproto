import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { _electron as electron } from "playwright";
import { Project } from "../dist/project.js";

async function rolloutFixture(root) {
  // An optional pair of saved project folders replays the original field session privately.
  const before = process.env.EASY_PROTO_ROLLOUT_BEFORE;
  const after = process.env.EASY_PROTO_ROLLOUT_AFTER;
  if (before || after) {
    assert.ok(before && after, "Supply both the before and approved project folders.");
    const path = join(root, "Replay");
    await cp(before, path, { recursive: true, errorOnExist: true, force: false });
    const baseline = await Project.open(path, undefined, "open");
    const approved = await Project.open(after, undefined, "open");
    assert.equal(approved.snapshot.manifest.projectId, baseline.snapshot.manifest.projectId);
    return { path, baseline, expected: approved.snapshot.sources };
  }
  const blank = await Project.open(join(root, "Blank"));
  const path = join(root, "Rollout.easyproto");
  await blank.saveCopy(path);
  const baseline = await Project.open(path);
  const execute = (operation, args) =>
    baseline.execute({
      projectId: baseline.snapshot.manifest.projectId,
      expectedRevision: baseline.snapshot.manifest.revision,
      commandId: randomUUID(),
      operation,
      arguments: args,
    });
  const { defaultPageId } = baseline.pageLayout;
  await execute("rename_page", { pageId: defaultPageId, name: "Mocks" });
  const { page } = await execute("create_page", { name: "logos" });
  const approved = new Map();
  for (let i = 0; i < 49; i++) {
    const study = i >= 44;
    const input = {
      name: (study ? "Study " : "Mock ") + i,
      x: i * 220,
      y: 0,
      width: 200,
      height: 160,
      html: `<main><b>Original</b> ${i}</main>`,
      css: `body{color:hsl(${i * 7}deg 50% 35%)}`,
    };
    const { artboard } =
      i === 0
        ? await execute("update_artboard", {
            artboardId: baseline.snapshot.manifest.artboards[0].id,
            patch: input,
          })
        : await execute("create_artboard", { ...input, pageId: study ? page.id : defaultPageId });
    approved.set(artboard.id, {
      html: study
        ? input.html
        : input.html.replace(
            "<b>Original</b>",
            '<svg width="16" viewBox="0 0 64 64"><path fill="none" stroke="currentColor" stroke-width="8" d="M7 38v13m12-24v18m13-30v34m13-30v18m12-24v13"/></svg>',
          ),
      css: input.css,
    });
  }
  return { path, baseline: await Project.open(path), expected: approved };
}

test(
  "one atomic MCP write rolls out 44 logos and one canvas Undo restores them",
  { timeout: 180000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "easy-proto-rollout-"));
    const client = new Client({ name: "rollout-test", version: "1" });
    let app;
    t.after(async () => {
      await client.close();
      await app?.close();
      await rm(root, { recursive: true, force: true });
    });
    const { path, baseline, expected } = await rolloutFixture(root);
    const { projectId, revision, artboards } = baseline.snapshot.manifest;
    const { pages } = baseline.pageLayout;
    const targets = artboards.filter((b) => b.pageId === pages.find((p) => p.name === "Mocks").id);
    const studies = artboards.filter((b) => b.pageId === pages.find((p) => p.name === "logos").id);
    assert.equal(targets.length, 44);
    assert.equal(studies.length, 5);
    const updates = targets.toReversed().map(({ id }) => {
      const original = baseline.snapshot.sources.get(id);
      const patch = Object.fromEntries(
        Object.entries(expected.get(id)).filter(([key, value]) => value !== original[key]),
      );
      assert.ok(Object.keys(patch).length);
      return { artboardId: id, patch };
    });
    const reserve = createServer().listen(0, "127.0.0.1");
    await once(reserve, "listening");
    const { port } = reserve.address();
    await new Promise((resolve) => reserve.close(resolve));
    const token = randomBytes(32).toString("base64url");
    app = await electron.launch({
      args: [process.cwd(), "--project=" + path],
      env: {
        ...process.env,
        EASY_PROTO_PORT: String(port),
        EASY_PROTO_TOKEN: token,
        EASY_PROTO_PROFILE: join(root, "profile"),
      },
    });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: /^Pages, current page / }).waitFor();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: "Bearer " + token } },
      }),
    );
    const context = async () => (await client.callTool({ name: "get_context" })).structuredContent;
    const { activationId } = await context();
    const call = (name, args) =>
      client.callTool({ name, arguments: { projectId, activationId, ...args } });
    const request = { expectedRevision: revision, commandId: randomUUID(), arguments: { updates } };
    const batch = (args) => call("update_artboards", args);
    const scene = () => page.evaluate(() => window.easyProto.getScene());
    const initialScene = await scene();
    await assert.rejects(
      page.evaluate(
        ({ generation, command }) => window.easyProto.arrangeArtboard(generation, command),
        {
          generation: initialScene.generation,
          command: { projectId, operation: "update_artboards", ...request },
        },
      ),
      /This control can only/,
    );
    const stale = await batch({ ...request, expectedRevision: revision - 1 });
    assert.equal(stale.structuredContent.code, "REVISION_CONFLICT");
    assert.equal(stale.structuredContent.currentRevision, revision);
    const missing = await batch({
      ...request,
      arguments: {
        updates: [...updates.slice(0, -1), { ...updates.at(-1), artboardId: randomUUID() }],
      },
    });
    assert.equal(missing.structuredContent.code, "ARTBOARD_NOT_FOUND");
    assert.equal(
      (await batch({ ...request, arguments: { updates: [updates[0], updates[0]] } })).isError,
      true,
    );
    assert.equal((await scene()).sceneVersion, initialScene.sceneVersion);
    assert.deepEqual((await Project.open(path)).snapshot.manifest, baseline.snapshot.manifest);
    await page.evaluate(() => {
      window.rolloutBusy = [];
      window.stopRolloutObserver = window.easyProto.onScene((scene) => {
        const ids = scene.artboards.filter((b) => b.agentWorking).map((b) => b.id);
        if (ids.length) window.rolloutBusy.push(ids);
      });
    });
    const start = performance.now();
    const response = await batch(request);
    const savedAt = performance.now();
    assert.equal(response.isError, undefined, JSON.stringify(response.structuredContent));
    const receipt = response.structuredContent;
    assert.equal(receipt.revision, revision + 1);
    assert.deepEqual(
      receipt.changedArtboardIds,
      targets.map((b) => b.id),
    );
    assert.deepEqual(
      receipt.artboards.map((b) => b.sourceRevision),
      targets.map(() => receipt.revision),
    );
    const busy = await page.evaluate(() => {
      window.stopRolloutObserver();
      return window.rolloutBusy;
    });
    assert.deepEqual(busy, [receipt.changedArtboardIds]);
    assert.ok((await scene()).artboards.every((b) => !b.agentWorking));
    const saved = await Project.open(path);
    assert.deepEqual(saved.snapshot.sources, expected);
    assert.deepEqual(
      saved.snapshot.manifest.artboards.filter((b) => studies.some((s) => s.id === b.id)),
      studies,
    );
    const warnings = new Set();
    let captures = 0;
    for (let i = 0; i < targets.length; i += 12) {
      const ids = targets.slice(i, i + 12).map((b) => b.id);
      const sheet = await call("capture_artboards", {
        revision: receipt.revision,
        artboardIds: ids,
      });
      assert.equal(sheet.isError, undefined, JSON.stringify(sheet.structuredContent));
      assert.deepEqual(
        sheet.structuredContent.captures.map((c) => [
          c.artboardId,
          c.sourceRevision,
          c.sourceDigest,
        ]),
        receipt.artboards.slice(i, i + 12).map((b) => [b.id, receipt.revision, b.sourceDigest]),
      );
      for (const w of sheet.structuredContent.warnings) warnings.add(w.artboardId);
      assert.ok(sheet.content[1].data);
      if (process.env.EASY_PROTO_EVIDENCE)
        await writeFile(
          join(process.env.EASY_PROTO_EVIDENCE, `rollout-${i + 1}.png`),
          Buffer.from(sheet.content[1].data, "base64"),
        );
      captures++;
    }
    t.diagnostic(
      `1 write (${Math.round(savedAt - start)} ms), ${captures} capture calls for 44 boards, ${Math.round(performance.now() - start)} ms through verification, ${warnings.size} boards with render warnings.`,
    );
    const late = await batch({ ...request, commandId: randomUUID() });
    assert.equal(late.structuredContent.code, "REVISION_CONFLICT");
    assert.deepEqual((await context()).artboards, saved.snapshot.manifest.artboards);
    await page.keyboard.press("Meta+z");
    async function waitForRevision(expected) {
      const deadline = Date.now() + 10000;
      while ((await scene()).revision !== expected && Date.now() < deadline) await delay(20);
      assert.equal((await scene()).revision, expected);
    }
    await waitForRevision(revision + 2);
    const undone = await Project.open(path);
    assert.equal(undone.snapshot.manifest.revision, revision + 2);
    for (const [id, original] of baseline.snapshot.sources) {
      const restored = undone.snapshot.sources.get(id);
      assert.ok(
        restored.html === original.html && restored.css === original.css,
        `Undo must restore source bytes on ${id}`,
      );
    }
    assert.deepEqual(
      undone.snapshot.manifest.artboards,
      artboards.map((b) =>
        studies.some((s) => s.id === b.id) ? b : { ...b, sourceRevision: revision + 2 },
      ),
    );
    assert.equal((await scene()).canUndo, false);
    assert.deepEqual((await batch(request)).structuredContent, receipt);
    assert.equal((await context()).revision, revision + 2);
    const { status, ...rest } = await undone.execute({
      projectId,
      operation: "update_artboards",
      ...request,
    });
    assert.equal(status, "committed");
    assert.deepEqual(rest.artboards, receipt.artboards);

    // A redo keeps the identity of the original batch. A second edit now covers it.
    await page.keyboard.press("Meta+Shift+z");
    await waitForRevision(revision + 3);
    const editId = randomUUID();
    const edit = await call("update_artboard", {
      commandId: editId,
      expectedRevision: revision + 3,
      arguments: { artboardId: targets[0].id, patch: { name: "Intervening edit" } },
    });
    assert.equal(edit.structuredContent.revision, revision + 4);
    const afterEdit = (await Project.open(path)).snapshot;
    const afterScene = await scene();
    const undo = {
      commandId: randomUUID(),
      expectedRevision: revision + 3,
      arguments: { targetCommandId: request.commandId },
    };
    assert.equal((await call("undo", { ...undo, arguments: {} })).isError, true);
    const { expectedRevision, ...withoutRevision } = undo;
    assert.equal((await call("undo", withoutRevision)).isError, true);
    const staleUndo = await call("undo", undo);
    assert.equal(staleUndo.structuredContent.code, "REVISION_CONFLICT");
    assert.equal(staleUndo.structuredContent.currentRevision, expectedRevision + 1);
    const wrongTarget = await call("undo", { ...undo, expectedRevision: revision + 4 });
    assert.equal(wrongTarget.structuredContent.code, "UNDO_CONFLICT");
    assert.equal(wrongTarget.structuredContent.currentRevision, revision + 4);
    assert.deepEqual((await Project.open(path)).snapshot, afterEdit);
    assert.deepEqual(await scene(), afterScene);

    const undoEdit = await call("undo", {
      commandId: randomUUID(),
      expectedRevision: revision + 4,
      arguments: { targetCommandId: editId },
    });
    assert.equal(undoEdit.structuredContent.revision, revision + 5);
    assert.equal(undoEdit.structuredContent.artboard.name, targets[0].name);
    const undoBatch = { ...undo, expectedRevision: revision + 5 };
    const restored = await call("undo", undoBatch);
    assert.equal(restored.structuredContent.revision, revision + 6);
    assert.deepEqual(
      restored.structuredContent.artboards.map((b) => b.id),
      receipt.changedArtboardIds,
    );
    const reopened = await Project.open(path);
    assert.deepEqual(reopened.snapshot.sources, baseline.snapshot.sources);
    assert.deepEqual((await call("undo", undoBatch)).structuredContent, restored.structuredContent);
    assert.equal((await context()).revision, revision + 6);
    const durableUndo = { projectId, operation: "undo", ...undoBatch };
    assert.deepEqual(await reopened.execute(durableUndo), restored.structuredContent);
    await assert.rejects(
      reopened.execute({ ...durableUndo, commandId: randomUUID(), expectedRevision: revision + 6 }),
      { code: "HISTORY_EMPTY" },
    );
  },
);
