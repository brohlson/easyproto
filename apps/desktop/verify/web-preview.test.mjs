import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Project } from "../dist/project.js";
import { readWebPreviewSettings, syncPagePreview, webPreviewStatus } from "../dist/web-preview.js";

const settings = { origin: "http://127.0.0.1:8787", token: "x".repeat(43) };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "easy-proto-web-export-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = await Project.open(join(root, "Mockups"));
  const projectId = project.snapshot.manifest.projectId;
  async function command(operation, args) {
    return project.execute({
      projectId,
      commandId: randomUUID(),
      expectedRevision: project.snapshot.manifest.revision,
      operation,
      arguments: args,
    });
  }
  const savedPage = await command("create_page", { name: "Share me" });
  const saved = await command("create_artboard", {
    name: "Only this board",
    pageId: savedPage.page.id,
    x: -180,
    y: 100,
    width: 320,
    height: 240,
    html: "<h1>Private canonical source</h1>",
    css: "body{color:#222}",
  });
  return { project, root, command, pageId: savedPage.page.id, artboardId: saved.artboard.id };
}

test("local preview settings accept only loopback origins and keep capability keys outside renderer input", async (t) => {
  const { root } = await fixture(t);
  const path = join(root, "web-preview.json");
  await writeFile(path, JSON.stringify(settings));
  assert.deepEqual(await readWebPreviewSettings(path, {}), settings);
  for (const origin of [
    "https://example.test",
    "file:///tmp/preview",
    "http://127.0.0.1:8787/elsewhere",
    "http://user:pass@localhost",
  ])
    await assert.rejects(
      readWebPreviewSettings(undefined, {
        EASY_PROTO_WEB_ORIGIN: origin,
        EASY_PROTO_WEB_TOKEN: settings.token,
      }),
    );
  assert.equal(await readWebPreviewSettings(undefined, {}), undefined);
});

test("page export pins one revision and sends only the selected page's PNGs and view metadata", async (t) => {
  const { project, command, pageId, artboardId } = await fixture(t);
  const pinned = project.snapshot;
  const png = Buffer.from("test capture bytes");
  let calls = 0;
  const capture = async (snapshot, board) => {
    assert.equal(snapshot, pinned);
    assert.equal(board.id, artboardId);
    calls++;
    await command("update_artboard", {
      artboardId,
      patch: { html: "<h1>Newer private source</h1>" },
    });
    return { png, details: { unresolved: [] } };
  };
  const id = randomUUID();
  const request = async (url, options) => {
    assert.equal(url.origin, settings.origin);
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, `Bearer ${settings.token}`);
    const manifest = options.body.get("manifest");
    assert.equal(manifest.includes("canonical"), false);
    assert.equal(manifest.includes("commands"), false);
    assert.equal(manifest.includes("html"), false);
    assert.equal(manifest.includes(settings.token), false);
    const uploaded = JSON.parse(manifest);
    assert.equal(uploaded.manifest.revision, pinned.manifest.revision);
    assert.deepEqual(
      uploaded.manifest.artboards.map(({ id }) => id),
      [artboardId],
    );
    assert.equal(uploaded.manifest.artboards[0].x, -180);
    assert.deepEqual(Buffer.from(await options.body.get(artboardId).arrayBuffer()), png);
    return Response.json({
      id,
      revision: pinned.manifest.revision,
      updatedAt: new Date().toISOString(),
    });
  };
  const info = await syncPagePreview(
    project,
    pinned.manifest.revision,
    pageId,
    settings,
    capture,
    new AbortController().signal,
    request,
  );
  assert.equal(calls, 1);
  assert.equal(info.url, `${settings.origin}/p/${id}`);
  assert.equal(project.snapshot.manifest.revision, pinned.manifest.revision + 1);
});

test("page export refuses stale, empty, unresolved, or cancelled captures before upload", async (t) => {
  const { project, command, pageId } = await fixture(t);
  const revision = project.snapshot.manifest.revision;
  let uploads = 0;
  const request = async () => {
    uploads++;
    return Response.json({});
  };
  const capture = async () => ({
    png: Buffer.from("png"),
    details: { unresolved: ["Missing font"] },
  });
  await assert.rejects(
    syncPagePreview(
      project,
      revision - 1,
      pageId,
      settings,
      capture,
      new AbortController().signal,
      request,
    ),
    /project changed/,
  );
  await assert.rejects(
    syncPagePreview(
      project,
      revision,
      pageId,
      settings,
      capture,
      new AbortController().signal,
      request,
    ),
    /unavailable images or fonts/,
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    syncPagePreview(project, revision, pageId, settings, capture, cancelled.signal, request),
  );
  const empty = await command("create_page", { name: "Empty" });
  await assert.rejects(
    syncPagePreview(
      project,
      project.snapshot.manifest.revision,
      empty.page.id,
      settings,
      capture,
      new AbortController().signal,
      request,
    ),
    /Add an artboard/,
  );
  assert.equal(uploads, 0);
});

test("existing preview links are constructed from trusted configuration, not returned URLs", async (t) => {
  const { project, pageId } = await fixture(t);
  const id = randomUUID();
  const status = await webPreviewStatus(
    project,
    pageId,
    settings,
    undefined,
    async (url, options) => {
      assert.equal(url.searchParams.get("pageId"), pageId);
      assert.equal(options.headers.authorization, `Bearer ${settings.token}`);
      return Response.json({
        preview: {
          id,
          revision: 2,
          updatedAt: new Date().toISOString(),
          url: "https://elsewhere.test",
        },
      });
    },
  );
  assert.equal(status.url, `${settings.origin}/p/${id}`);
});
