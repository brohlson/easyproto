import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { png } from "./fixtures/png.mjs";
import { test } from "node:test";
import worker from "./worker/index.ts";

function d1(database) {
  return {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          return database.prepare(sql).get(...args) ?? null;
        },
        async run() {
          return { success: true, meta: database.prepare(sql).run(...args) };
        },
        async all() {
          return { results: database.prepare(sql).all(...args) };
        },
      };
    },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        database.exec("COMMIT");
        return results;
      } catch (failure) {
        database.exec("ROLLBACK");
        throw failure;
      }
    },
  };
}
async function fixture(t) {
  const database = new DatabaseSync(":memory:");
  database.exec(
    await readFile(new URL("migrations/0001_page_previews.sql", import.meta.url), "utf8"),
  );
  t.after(() => database.close());
  const objects = new Map();
  const token = "x".repeat(43);
  const env = {
    DB: d1(database),
    LOCAL_PUBLISH_TOKEN: token,
    PREVIEWS: {
      async put(key, bytes) {
        objects.set(key, new Uint8Array(bytes));
      },
      async get(key) {
        const bytes = objects.get(key);
        return bytes
          ? {
              body: new ReadableStream({
                start(controller) {
                  controller.enqueue(bytes);
                  controller.close();
                },
              }),
            }
          : null;
      },
      async delete(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
      },
    },
    ASSETS: {
      fetch: async () =>
        new Response("<main>App shell</main>", { headers: { "content-type": "text/html" } }),
    },
  };
  const projectId = randomUUID(),
    pageId = randomUUID(),
    artboardId = randomUUID();
  const image = png();
  const metadata = {
    projectId,
    pageId,
    manifest: {
      schemaVersion: 1,
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
          bytes: image.length,
          digest: createHash("sha256").update(image).digest("hex"),
        },
      ],
    },
  };
  function sync(payload = metadata, data = image, extraHeaders = {}) {
    const body = new FormData();
    body.set("manifest", JSON.stringify(payload));
    body.set(artboardId, new Blob([data], { type: "image/png" }), "board.png");
    return worker.fetch(
      new Request("http://127.0.0.1:8787/api/local/sync", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, ...extraHeaders },
        body,
      }),
      env,
    );
  }
  return { database, objects, env, metadata, image, sync, token };
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

test("page sync keeps one URL, publishes atomically, and preserves pinned image URLs", async (t) => {
  const { database, env, metadata, image, sync } = await fixture(t);
  const first = await sync();
  assert.equal(first.status, 200);
  const saved = await first.json();
  let response = await worker.fetch(
    new Request(`http://127.0.0.1:8787/p/${saved.id}`, { headers: { accept: "application/json" } }),
    env,
  );
  const view = await response.json();
  assert.equal(view.kind, "page-preview");
  assert.equal(view.artboards[0].x, -400);
  assert.equal(JSON.stringify(view).includes(metadata.projectId), false);
  assert.equal(JSON.stringify(view).includes(metadata.pageId), false);
  assert.equal(JSON.stringify(view).includes(metadata.manifest.artboards[0].digest), false);
  metadata.manifest.revision = 2;
  assert.equal((await (await sync()).json()).id, saved.id);
  assert.equal(database.prepare("SELECT count(*) AS count FROM page_previews").get().count, 1);
  response = await worker.fetch(
    new Request(`http://127.0.0.1:8787${view.artboards[0].imageUrl}`),
    env,
  );
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  metadata.manifest.revision = 1;
  assert.equal((await sync()).status, 409);
  assert.equal(
    database.prepare("SELECT source_revision FROM page_previews").get().source_revision,
    2,
  );
});

test("page sync rejects scope, integrity, and browser-origin violations without exposing partial uploads", async (t) => {
  const { database, env, metadata, image, sync, objects, token } = await fixture(t);
  assert.equal((await sync(metadata, image, { origin: "http://127.0.0.1:8787" })).status, 403);
  assert.equal(
    (await sync(metadata, image, { authorization: "Bearer " + "y".repeat(43) })).status,
    403,
  );
  const bad = structuredClone(metadata);
  bad.manifest.artboards[0].width = 200;
  assert.equal((await sync(bad)).status, 400);
  bad.manifest.artboards[0].width = 100;
  bad.manifest.artboards[0].digest = "0".repeat(64);
  assert.equal((await sync(bad)).status, 400);
  assert.equal(database.prepare("SELECT count(*) AS count FROM page_previews").get().count, 0);
  env.PREVIEWS.put = async (key, bytes) => {
    objects.set(key, bytes);
    throw new Error("storage failed");
  };
  assert.equal((await sync()).status, 500);
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

test("missing snapshots and undeclared artboards return unavailable with no-store headers", async (t) => {
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
  const path = view.artboards[0].imageUrl.replace(/[^/]+\.png$/, `${randomUUID()}.png`);
  assert.equal((await worker.fetch(new Request(`http://127.0.0.1:8787${path}`), env)).status, 404);
  const shell = await worker.fetch(new Request(`http://127.0.0.1:8787/p/${id}`), env);
  assert.match(shell.headers.get("content-security-policy"), /frame-src 'none'/);
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
