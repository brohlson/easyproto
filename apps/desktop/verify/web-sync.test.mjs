import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { Project } from "../dist/project.js";
import { syncPagePreview, webPreviewStatus } from "../dist/web-preview.js";
import worker from "../../web/worker/index.ts";
import { png } from "../../web/fixtures/png.mjs";
import { workerFixture } from "../../web/fixtures/worker.mjs";
import { inspectLocalServer } from "../../../scripts/local-web-server.mjs";

async function fixture(t) {
  const storage = await workerFixture(t);
  const root = await mkdtemp(join(tmpdir(), "easy-proto-page-sync-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let origin;
  const listener = createServer(async (incoming, outgoing) => {
    try {
      const request = new Request(`${origin}${incoming.url}`, {
        method: incoming.method,
        headers: incoming.headers,
        ...(incoming.method === "POST" ? { body: Readable.toWeb(incoming), duplex: "half" } : {}),
      });
      const response = await worker.fetch(request, storage.env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500);
      outgoing.end();
    }
  });
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  origin = `http://127.0.0.1:${listener.address().port}`;
  const settings = { origin, token: storage.token };
  const project = await Project.open(join(root, "Mockups"));
  const command = (operation, args) =>
    project.execute({
      operation,
      arguments: args,
      projectId: project.snapshot.manifest.projectId,
      commandId: randomUUID(),
      expectedRevision: project.snapshot.manifest.revision,
    });
  const { page } = await command("create_page", { name: "Shared page" });
  const { artboard } = await command("create_artboard", {
    pageId: page.id,
    name: "Shared board",
    x: -320,
    y: 100,
    width: 320,
    height: 240,
    html: "<h1>Private source marker</h1>",
    css: "body { color: red; }",
  });
  const { page: privatePage } = await command("create_page", { name: "Unshared page marker" });
  const { artboard: privateBoard } = await command("create_artboard", {
    pageId: privatePage.id,
    name: "Unshared board marker",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    html: "<h1>Unshared source marker</h1>",
    css: "",
  });
  const capture = async (_snapshot, board) => ({
    png: png(board.width, board.height),
    details: { unresolved: [] },
  });
  const sync = (takeCapture = capture, signal = new AbortController().signal) =>
    syncPagePreview(
      project,
      project.snapshot.manifest.revision,
      page.id,
      settings,
      takeCapture,
      signal,
    );
  const view = async (url) =>
    (await fetch(url, { headers: { accept: "application/json" } })).json();
  return {
    ...storage,
    project,
    command,
    page,
    artboard,
    privatePage,
    privateBoard,
    settings,
    capture,
    sync,
    view,
  };
}

test("desktop export crosses HTTP into the Worker and keeps a scoped, stable URL across edits", async (t) => {
  const {
    project,
    command,
    page,
    artboard,
    privateBoard,
    settings,
    capture,
    sync,
    view,
    database,
  } = await fixture(t);
  assert.equal(await inspectLocalServer(settings), true);
  assert.equal((await webPreviewStatus(project, page.id, settings)).url, undefined);
  const pinned = project.snapshot;
  const saved = await sync(async (snapshot, board, signal) => {
    assert.equal(snapshot, pinned);
    assert.equal(board.id, artboard.id);
    assert.equal(signal.aborted, false);
    await command("update_artboard", {
      artboardId: board.id,
      patch: { html: "<h1>Newer private source marker</h1>" },
    });
    return capture(snapshot, board);
  });
  assert.equal(saved.revision, pinned.manifest.revision);
  assert.equal(saved.artboardCount, 1);
  assert.equal(project.snapshot.manifest.revision, saved.revision + 1);
  const first = await view(saved.url);
  assert.deepEqual(
    first.artboards.map(({ id }) => id),
    [artboard.id],
  );
  assert.equal(first.artboards[0].x, -320);
  for (const marker of [
    "Private source marker",
    "Unshared",
    privateBoard.id,
    project.snapshot.manifest.projectId,
    settings.token,
  ])
    assert.equal(JSON.stringify(first).includes(marker), false);
  assert.equal("revision" in first, false);
  const firstDocument = new URL(first.artboards[0].iframeUrl, settings.origin);
  const firstHtml = await (await fetch(firstDocument)).text();
  assert.match(firstHtml, /Private source marker/);
  assert.doesNotMatch(firstHtml, /Newer private source marker|Unshared source marker/);
  const firstCss = new URL("./board.css", firstDocument);
  assert.equal(await (await fetch(firstCss)).text(), "body { color: red; }");
  await command("update_artboard", {
    artboardId: artboard.id,
    patch: { name: "Updated board", width: 640, height: 480 },
  });
  const updated = await sync();
  assert.equal(updated.url, saved.url);
  assert.ok(updated.revision > saved.revision);
  const latest = await view(updated.url);
  assert.equal("revision" in latest, false);
  assert.equal(latest.artboards[0].name, "Updated board");
  assert.equal(latest.artboards[0].width, 640);
  assert.notEqual(latest.artboards[0].iframeUrl, first.artboards[0].iframeUrl);
  assert.equal(await (await fetch(firstDocument)).text(), firstHtml);
  assert.deepEqual(await webPreviewStatus(project, page.id, settings), updated);
  assert.equal(database.prepare("SELECT count(*) AS count FROM page_previews").get().count, 1);
  await assert.rejects(
    webPreviewStatus(project, page.id, { ...settings, token: "y".repeat(43) }),
    /preview service/,
  );
});

test("an unresolved live preview leaves the last published page intact", async (t) => {
  const { sync, view, objects, database } = await fixture(t);
  const saved = await sync();
  const before = await view(saved.url);
  await assert.rejects(
    sync(async () => ({
      png: png(100, 100),
      details: { unresolved: ["Missing asset: private.png"] },
    })),
    /unavailable images or fonts/,
  );
  assert.deepEqual(await view(saved.url), before);
  assert.equal(objects.size, 2);
  assert.equal(database.prepare("SELECT count(*) AS count FROM snapshots").get().count, 1);
});

test("cancelling during capture never sends a partial export to the Worker", async (t) => {
  const { sync, view, capture, objects, database } = await fixture(t);
  const saved = await sync();
  const before = await view(saved.url);
  const controller = new AbortController();
  await assert.rejects(
    sync(async (snapshot, board) => {
      controller.abort();
      return capture(snapshot, board);
    }, controller.signal),
    { name: "AbortError" },
  );
  assert.deepEqual(await view(saved.url), before);
  assert.equal(objects.size, 2);
  assert.equal(database.prepare("SELECT count(*) AS count FROM snapshots").get().count, 1);
});
