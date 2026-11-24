import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectLocalServer, waitForLocalServer } from "./local-web-server.mjs";
import { enforcePrivateMode } from "./local-web-settings.mjs";

async function server(t, handler) {
  const listener = createServer(handler);
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  return `http://127.0.0.1:${listener.address().port}`;
}

test("the launcher reuses only a healthy server with matching publisher settings", async (t) => {
  const token = "x".repeat(43);
  let healthy = true;
  const origin = await server(t, (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/health") {
      assert.equal(request.headers.authorization, undefined);
      response.end(JSON.stringify({ ready: healthy, service: "easy-proto-web" }));
    } else {
      assert.match(request.url, /^\/api\/local\/page\?projectId=[\w-]+&pageId=[\w-]+$/);
      response.statusCode = request.headers.authorization === `Bearer ${token}` ? 200 : 403;
      response.end(JSON.stringify({ preview: null }));
    }
  });
  assert.equal(await inspectLocalServer({ origin, token }), true);
  await assert.rejects(
    inspectLocalServer({ origin, token: "y".repeat(43) }),
    /different publishing settings/,
  );
  healthy = false;
  await assert.rejects(inspectLocalServer({ origin, token }), /another or outdated service/);
});

test("the launcher withholds its capability from an unrelated listener", async (t) => {
  let requests = 0;
  const origin = await server(t, (request, response) => {
    requests++;
    assert.equal(request.headers.authorization, undefined);
    response.end("An unrelated development server");
  });
  await assert.rejects(inspectLocalServer({ origin, token: "x".repeat(43) }), /occupied/);
  assert.equal(requests, 1);
});

test("an unused port starts a server, while a stopped launcher cannot continue waiting", async () => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const origin = `http://127.0.0.1:${listener.address().port}`;
  await new Promise((resolve) => listener.close(resolve));
  const settings = { origin, token: "x".repeat(43) };
  assert.equal(await inspectLocalServer(settings), false);
  const child = { exitCode: null, signalCode: null };
  await assert.rejects(
    waitForLocalServer(settings, child, () => true),
    /stopped/,
  );
  await assert.rejects(
    waitForLocalServer(settings, { ...child, signalCode: "SIGTERM" }, () => false),
    /stopped/,
  );
});

test("existing local publisher paths are tightened before reuse", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "easy-proto-private-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, ".local");
  const settings = join(directory, "web-preview.json");
  const vars = join(root, ".dev.vars");
  await mkdir(directory, { mode: 0o755 });
  await writeFile(settings, "private", { mode: 0o644 });
  await writeFile(vars, "private", { mode: 0o644 });
  // Ensure the setup reflects the permissive pre-existing paths this guards against.
  await chmod(directory, 0o755);
  await chmod(settings, 0o644);
  await chmod(vars, 0o644);
  await enforcePrivateMode(directory, 0o700);
  await enforcePrivateMode(settings, 0o600);
  await enforcePrivateMode(vars, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(settings)).mode & 0o777, 0o600);
  assert.equal((await stat(vars)).mode & 0o777, 0o600);
});
