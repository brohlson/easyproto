import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

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
        return bytes ? { body: new Blob([bytes]).stream() } : null;
      },
      async delete(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
      },
    },
    ASSETS: {
      fetch: async () =>
        new Response(
          '<!doctype html><title>Easy Proto</title><div id="root"></div><script type="module" src="/app.js"></script>',
          { headers: { "content-type": "text/html" } },
        ),
    },
  };
  return { database, objects, token, env };
}
