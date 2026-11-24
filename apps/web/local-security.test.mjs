import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { test } from "node:test";
import { createServer, loadConfigFromFile } from "vite";

test("Vite denies private preview configuration, state, and project files without blocking UI assets", async (t) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const web = join(root, "apps/web");
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "test" },
    join(web, "vite.config.ts"),
  );
  assert.ok(loaded);
  const configuration = loaded.config;
  const suffix = randomUUID();
  const locations = [
    [join(root, ".local", `security-${suffix}`), "web-preview.json"],
    [join(web, ".cloudflare", `security-${suffix}`), "state.txt"],
    [join(root, "mocks/.workspace", `security-${suffix}`), "private.txt"],
  ];
  const extra = [
    join(web, `.dev.vars.${suffix}`),
    join(web, `security-${suffix}.easyproto`),
    join(web, `security-${suffix}.key`),
  ];
  const marker = `private-test-${suffix}`;
  let server;
  t.after(async () => {
    await server?.close();
    for (const [directory] of locations) await rm(directory, { recursive: true, force: true });
    for (const file of extra) await rm(file, { force: true });
  });
  for (const [directory, name] of locations) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, name), marker, { flag: "wx", mode: 0o600 });
  }
  for (const file of extra) await writeFile(file, marker, { flag: "wx", mode: 0o600 });
  server = await createServer({
    configFile: false,
    root: web,
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      fs: { allow: [root], deny: configuration.server.fs.deny },
    },
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const file of [...locations.map(([directory, name]) => join(directory, name)), ...extra]) {
    const response = await fetch(`${origin}/@fs${file}`);
    assert.equal(response.status, 403, file.slice(root.length));
    assert.equal((await response.text()).includes(marker), false);
  }
  const icon = await fetch(`${origin}/@fs${join(root, "packages/ui/fold.svg")}`);
  assert.equal(icon.status, 200);
  assert.match(await icon.text(), /<svg/);
});
