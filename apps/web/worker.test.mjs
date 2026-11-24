import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { previewHtml } from "@easy-proto/preview";
import { chromium } from "playwright";
import { checkWorkspaceHeader } from "../../scripts/workspace-header-check.mjs";
import { png } from "./fixtures/png.mjs";
import { workerFixture } from "./fixtures/worker.mjs";
import { test } from "node:test";
import worker from "./worker/index.ts";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const member = (bytes) => ({ bytes: bytes.length, digest: digest(bytes) });

async function fixture(t) {
  const { database, objects, token, env } = await workerFixture(t);
  const projectId = randomUUID();
  const pageId = randomUUID();
  const artboardId = randomUUID();
  const rawHtml =
    '<html><head></head><body><h1>Live board</h1><script>parent.pwned=1</script><button onclick="fetch(\'https://example.test\')">No</button><a href="https://example.test">Link</a><iframe src="https://example.test"></iframe><img src="assets/pixel.png"></body></html>';
  const document = Buffer.from(previewHtml(rawHtml, false));
  const stylesheet = Buffer.from(
    "body{margin:0;color:rgb(12,34,56);background-image:url(assets/pixel.png)}",
  );
  const image = png();
  const metadata = {
    projectId,
    pageId,
    manifest: {
      schemaVersion: 2,
      projectName: "Notes",
      pageName: "Concepts",
      revision: 1,
      artboards: [
        {
          id: artboardId,
          name: "Home",
          x: -400,
          y: 120,
          width: 100,
          height: 100,
          document: member(document),
          stylesheet: member(stylesheet),
          assets: [{ path: "pixel.png", mime: "image/png", ...member(image) }],
        },
      ],
    },
  };
  function sync(payload = metadata, files = {}, extraHeaders = {}) {
    const board = payload.manifest.artboards[0];
    const body = new FormData();
    body.set("manifest", JSON.stringify(payload));
    body.set(
      `${board.id}:document`,
      new Blob([files.document ?? document], { type: "text/html" }),
      "index.html",
    );
    body.set(
      `${board.id}:stylesheet`,
      new Blob([files.stylesheet ?? stylesheet], { type: "text/css" }),
      "board.css",
    );
    body.set(
      `${board.id}:asset:0`,
      new Blob([files.image ?? image], { type: "image/png" }),
      "pixel.png",
    );
    if (files.extra) body.set("unexpected", new Blob(["x"]), "x.txt");
    return worker.fetch(
      new Request("http://127.0.0.1:8787/api/local/sync", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, ...extraHeaders },
        body,
      }),
      env,
    );
  }
  return { database, objects, env, metadata, document, image, rawHtml, sync, token };
}

test("waitlist normalizes and deduplicates emails and rejects invalid or cross-origin requests", async (t) => {
  const { database, env } = await fixture(t);
  const joinList = (email, origin = "http://127.0.0.1:8787", website = "") =>
    worker.fetch(
      new Request("http://127.0.0.1:8787/api/waitlist", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ email, website }),
      }),
      env,
    );
  assert.equal((await joinList(" TEST@example.test ")).status, 200);
  assert.equal((await joinList("test@example.test")).status, 200);
  assert.deepEqual(
    database
      .prepare("SELECT email FROM waitlist")
      .all()
      .map(({ email }) => email),
    ["test@example.test"],
  );
  assert.equal((await joinList("invalid")).status, 400);
  assert.equal((await joinList("other@example.test", "https://elsewhere.test")).status, 403);
  assert.equal((await joinList("bot@example.test", undefined, "bot-filled-field")).status, 200);
  assert.equal(database.prepare("SELECT count(*) AS count FROM waitlist").get().count, 1);
});

test("the published page matches the desktop header in Light and Dark at both widths", async (t) => {
  const origin = "http://127.0.0.1:8787";
  const { env, sync } = await fixture(t);
  const saved = await sync();
  assert.equal(saved.ok, true);
  const { id } = await saved.json();
  const assets = new URL("./.cloudflare/output/v1/workers/default/assets/", import.meta.url);
  const contentTypes = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  env.ASSETS.fetch = async (request) => {
    const path = new URL(request.url).pathname;
    const asset = path.startsWith("/assets/") ? path.slice(1) : "index.html";
    const extension = asset.slice(asset.lastIndexOf("."));
    return new Response(await readFile(new URL(asset, assets)), {
      headers: { "content-type": contentTypes[extension] },
    });
  };

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.route(`${origin}/**`, async (route) => {
    const response = await worker.fetch(new Request(route.request().url()), env);
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  for (const colorScheme of ["light", "dark"]) {
    for (const width of [1180, 660]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 600 });
      await page.goto(`${origin}/p/${id}`);
      await page.frameLocator("iframe").getByRole("heading", { name: "Live board" }).waitFor();
      assert.equal(await page.title(), "Notes - Concepts");
      assert.equal(await page.locator(".ep-workspace-project").innerText(), "Notes");
      assert.equal(await page.locator(".ep-workspace-page").innerText(), "Concepts");
      await checkWorkspaceHeader(page, { dark: colorScheme === "dark", compact: width === 660 });
    }
  }
});

test("page sync keeps one URL and serves immutable sandboxed HTML, CSS, and assets", async (t) => {
  const { database, env, metadata, image, sync } = await fixture(t);
  const first = await sync();
  assert.equal(first.status, 200);
  const saved = await first.json();
  const getView = () =>
    worker.fetch(
      new Request(`http://127.0.0.1:8787/p/${saved.id}`, {
        headers: { accept: "application/json" },
      }),
      env,
    );
  const view = await (await getView()).json();
  assert.equal(view.kind, "page-preview");
  assert.equal(view.artboards[0].x, -400);
  const shellResponse = await worker.fetch(new Request(`http://127.0.0.1:8787/p/${saved.id}`), env);
  const shell = await shellResponse.text();
  assert.match(shell, /<title>Notes - Concepts<\/title>/);
  assert.match(shell, /id="page-data"/);
  for (const hidden of ["revision", metadata.projectId, metadata.pageId, "digest", "bytes"])
    assert.equal(JSON.stringify(view).includes(hidden), false);
  const documentUrl = new URL(view.artboards[0].iframeUrl, "http://127.0.0.1:8787");
  let response = await worker.fetch(new Request(documentUrl), env);
  const firstDocument = await response.text();
  assert.match(response.headers.get("content-security-policy"), /^sandbox;/);
  assert.match(response.headers.get("content-security-policy"), /connect-src 'none'/);
  assert.match(firstDocument, /Live board/);
  assert.doesNotMatch(firstDocument, /script|onclick|https:\/\/example\.test|iframe/i);
  response = await worker.fetch(new Request(new URL("./board.css", documentUrl)), env);
  assert.equal(response.headers.get("content-type"), "text/css; charset=utf-8");
  assert.match(await response.text(), /rgb\(12,34,56\)/);
  response = await worker.fetch(new Request(new URL("./assets/pixel.png", documentUrl)), env);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  metadata.manifest.revision = 2;
  assert.equal((await (await sync()).json()).id, saved.id);
  const updated = await (await getView()).json();
  assert.notEqual(updated.artboards[0].iframeUrl, view.artboards[0].iframeUrl);
  assert.equal((await worker.fetch(new Request(documentUrl), env)).status, 200);
  assert.equal(database.prepare("SELECT count(*) AS count FROM page_previews").get().count, 1);
  metadata.manifest.revision = 1;
  assert.equal((await sync()).status, 409);
});

test("page sync rejects unsafe or mismatched members without exposing partial uploads", async (t) => {
  const { database, env, metadata, document, rawHtml, sync, objects, token } = await fixture(t);
  assert.equal((await sync(metadata, {}, { origin: "http://127.0.0.1:8787" })).status, 403);
  assert.equal(
    (await sync(metadata, {}, { authorization: "Bearer " + "y".repeat(43) })).status,
    403,
  );
  assert.equal((await sync(metadata, { image: png(200, 100) })).status, 400);
  assert.equal((await sync(metadata, { extra: true })).status, 400);
  const unsafe = Buffer.from(rawHtml);
  const unsafeMetadata = structuredClone(metadata);
  unsafeMetadata.manifest.artboards[0].document = member(unsafe);
  assert.equal((await sync(unsafeMetadata, { document: unsafe })).status, 400);
  assert.equal(database.prepare("SELECT count(*) AS count FROM page_previews").get().count, 0);
  assert.equal(objects.size, 0);
  env.PREVIEWS.put = async (key, bytes) => {
    objects.set(key, bytes);
    throw new Error("storage failed");
  };
  assert.equal((await sync(metadata, { document })).status, 500);
  assert.equal(objects.size, 0);
  assert.equal(database.prepare("SELECT count(*) AS count FROM snapshots").get().count, 0);
  assert.equal(
    (
      await worker.fetch(
        new Request("https://example.test/api/local/page", {
          headers: { authorization: `Bearer ${token}` },
        }),
        env,
      )
    ).status,
    403,
  );
});

test("artifact routes reject undeclared boards, assets, traversal, and queries", async (t) => {
  const { env, sync } = await fixture(t);
  const { id } = await (await sync()).json();
  const missing = await worker.fetch(
    new Request(`http://127.0.0.1:8787/api/previews/${randomUUID()}`),
    env,
  );
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("cache-control"), /no-store/);
  const view = await (
    await worker.fetch(new Request(`http://127.0.0.1:8787/api/previews/${id}`), env)
  ).json();
  const documentUrl = new URL(view.artboards[0].iframeUrl, "http://127.0.0.1:8787");
  assert.equal(
    (await worker.fetch(new Request(new URL("./assets/private.png", documentUrl)), env)).status,
    404,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request(documentUrl.href.replace(view.artboards[0].id, randomUUID())),
        env,
      )
    ).status,
    404,
  );
  assert.equal(
    (await worker.fetch(new Request(new URL("./assets/%252e%252e/private.png", documentUrl)), env))
      .status,
    404,
  );
  assert.equal((await worker.fetch(new Request(documentUrl.href + "?secret=1"), env)).status, 404);
  const shell = await worker.fetch(new Request(`http://127.0.0.1:8787/p/${id}`), env);
  assert.match(shell.headers.get("content-security-policy"), /frame-src 'self'/);
});

test("waitlist schema persists across local database reopening", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "easy-proto-waitlist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "local.sqlite");
  let database = new DatabaseSync(path);
  database.exec(
    await readFile(new URL("migrations/0001_page_previews.sql", import.meta.url), "utf8"),
  );
  database
    .prepare("INSERT INTO waitlist VALUES (?, ?)")
    .run("saved@example.test", new Date().toISOString());
  database.close();
  database = new DatabaseSync(path);
  assert.equal(database.prepare("SELECT email FROM waitlist").get().email, "saved@example.test");
  database.close();
});
