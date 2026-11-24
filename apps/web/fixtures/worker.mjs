import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const assets = new URL("../.cloudflare/output/v1/workers/default/assets/", import.meta.url);
const contentTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

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

export async function workerFixture(t) {
  const database = new DatabaseSync(":memory:");
  database.exec(
    await readFile(new URL("../migrations/0001_page_previews.sql", import.meta.url), "utf8"),
  );
  database.exec(
    await readFile(new URL("../migrations/0002_hosted_shares.sql", import.meta.url), "utf8"),
  );
  database.exec(
    await readFile(
      new URL("../migrations/0003_hosted_storage_budget.sql", import.meta.url),
      "utf8",
    ),
  );
  t.after(() => database.close());
  database.exec(
    await readFile(new URL("../migrations/0004_hosted_publications.sql", import.meta.url), "utf8"),
  );
  const objects = new Map();
  const token = "x".repeat(43);
  const env = {
    DB: d1(database),
    LOCAL_PUBLISH_TOKEN: token,
    PREVIEWS: {
      async head(key) {
        return objects.has(key) ? {} : null;
      },
      async put(key, bytes) {
        objects.set(key, new Uint8Array(bytes));
      },
      async get(key) {
        const bytes = objects.get(key);
        return bytes ? { body: new Blob([bytes]).stream() } : null;
      },
      async delete(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
      },
    },
    ASSETS: {
      async fetch(request) {
        const path = new URL(request.url).pathname;
        const contentType = contentTypes[extname(path)];
        try {
          const bytes = await readFile(new URL(path.slice(1), assets));
          return new Response(request.method === "HEAD" ? null : bytes, {
            headers: { "content-type": contentType },
          });
        } catch (error) {
          if (error.code === "ENOENT") return new Response(null, { status: 404 });
          throw error;
        }
      },
    },
  };
  return { database, objects, token, env };
}
