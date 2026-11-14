import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { _electron as electron } from "playwright";

const onePixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const evidence = process.env.EASY_PROTO_EVIDENCE ? resolve(process.env.EASY_PROTO_EVIDENCE) : null;

function raw(url, options, body = "{}") {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", ...options }, (res) => {
      res.resume();
      res.once("end", () => resolve(res.statusCode));
    });
    req.once("error", reject);
    req.end(body);
  });
}

test("macOS Electron and real MCP client exercise the complete desktop slice", { timeout: 85_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "easy-proto-smoke-"));
  const project = join(root, "Test project");
  const token = randomBytes(32).toString("base64url");
  const trap = createServer((_request, response) => response.end());
  let connections = 0;
  trap.on("connection", () => { connections++; });
  await new Promise((resolve) => trap.listen(0, "127.0.0.1", resolve));
  const blocked = `http://127.0.0.1:${trap.address().port}`;
  const reserve = createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  let app, client, desktop;
  const logs = [];
  const statuses = [];
  t.after(async () => {
    try {
      await client?.close();
      if (app) await app.close();
    } finally {
      trap.closeAllConnections();
      trap.close();
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await writeFile(join(evidence, "desktop-stages.json"), JSON.stringify({ statuses, logs }, null, 2));
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  async function launch() {
    app = await electron.launch({
      args: [process.cwd(), `--project=${project}`],
      env: { ...process.env, EASY_PROTO_PROFILE: join(root, "profile"), EASY_PROTO_TOKEN: token, EASY_PROTO_PORT: String(port) },
      timeout: 20_000,
    });
    desktop = await app.firstWindow();
    for (const stream of [app.process().stdout, app.process().stderr]) stream.on("data", (data) => logs.push(data.toString()));
    await desktop.getByText("Saved · Revision", { exact: false }).waitFor({ timeout: 8000 });
    await desktop.frameLocator('iframe[title="Field notes"]').getByRole("heading", { name: "Make room for ideas." }).waitFor({ timeout: 8000 });
    client = new Client({ name: "easy-proto-integration", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { Authorization: "Bearer " + token } },
    }));
    return endpoint;
  }

  const data = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, undefined, JSON.stringify(response.content));
    return response.structuredContent;
  };
  const failure = async (name, args, code) => {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, true, JSON.stringify(response.content));
    assert.equal(response.structuredContent.code, code);
    return response.structuredContent;
  };
  const close = async () => {
    await client.close();
    client = undefined;
    await app.close();
    app = undefined;
  };

  await mkdir(join(project, "assets"), { recursive: true });
  await writeFile(join(project, "assets", "local.png"), onePixel);
  await writeFile(join(root, "outside.txt"), "unrelated synthetic fixture");
  const url = await launch();
  statuses.push("Electron window displayed starter HTML");
  const auth = { authorization: "Bearer " + token, "content-type": "application/json" };
  assert.equal(await raw(url, { headers: {} }), 401);
  assert.equal(await raw(url, { headers: { ...auth, origin: "null" } }), 403);
  assert.equal(await raw(url, { headers: { ...auth, host: "localhost:" + new URL(url).port } }), 403);
  assert.equal(await raw(url, { headers: auth }, " ".repeat(3 * 1024 * 1024 + 1)), 413);
  const protocolHeader = await raw(url, { headers: { ...auth,
    accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25",
  } }, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
  assert.equal(protocolHeader, 200);
  const list = await client.listTools();
  assert.deepEqual(list.tools.map(({ name }) => name).sort(), [
    "capture_artboard", "create_artboard", "get_artboard", "get_context", "update_artboard",
  ]);
  const { projectId, revision } = await data("get_context");
  statuses.push({ electron: await app.evaluate(() => process.versions.electron), platform: process.platform, arch: process.arch, node: process.version });
  assert.equal(revision, 0);
  await failure("get_artboard", { projectId: randomUUID(), artboardId: randomUUID() }, "PROJECT_SCOPE");
  statuses.push("SDK discovery, bearer, Host, Origin, body bound and project scope verified");

  const created = {
    projectId, expectedRevision: 0, commandId: randomUUID(),
    arguments: { name: "Agent mockup", width: 320, height: 240, x: 70, y: 90, html: "<h1>Prototype one</h1>", css: "body{background:#ddb}" },
  };
  const initial = await data("create_artboard", created);
  const artboardId = initial.artboard.id;
  assert.equal(initial.revision, 1);
  const frame = desktop.frameLocator('iframe[title="Agent mockup"]');
  await frame.getByRole("heading", { name: "Prototype one" }).waitFor();
  statuses.push("MCP create rendered its HTML in the live canvas");
  const board = desktop.locator(".react-flow__node").filter({ hasText: "Agent mockup" });
  const initialFrame = desktop.frames().find((candidate) => candidate.url().includes(artboardId));
  await board.click({ position: { x: 60, y: 60 } });
  assert.ok((await board.getAttribute("class")).includes("selected"));
  const canvasTransform = async () => desktop.locator(".react-flow__viewport").getAttribute("style");
  const beforePan = await canvasTransform();
  const canvas = await desktop.locator(".react-flow__pane").boundingBox();
  await desktop.mouse.move(canvas.x + 40, canvas.y + 45);
  await desktop.mouse.down();
  await desktop.mouse.move(canvas.x + 90, canvas.y + 73, { steps: 5 });
  await desktop.mouse.up();
  if (beforePan === await canvasTransform()) throw new Error("Canvas pan did not change the viewport.");
  const beforeZoom = await canvasTransform();
  await desktop.getByRole("button", { name: /zoom in/i }).click();
  await desktop.waitForFunction((before) => document.querySelector(".react-flow__viewport").getAttribute("style") !== before, beforeZoom);
  assert.equal(await initialFrame.evaluate(() => innerWidth), 320);
  const box = await board.boundingBox();
  await desktop.mouse.move(box.x + 55, box.y + 55);
  await desktop.mouse.down();
  await desktop.mouse.move(box.x + 99, box.y + 115, { steps: 8 });
  await desktop.mouse.up();
  await desktop.getByText("Saved · Revision 2", { exact: true }).waitFor({ timeout: 5000 });
  const moved = await data("get_artboard", { projectId, artboardId });
  assert.notEqual(moved.artboard.x, 70);
  assert.notEqual(moved.artboard.y, 90);
  assert.equal(moved.artboard.sourceRevision, 1);
  assert.equal(desktop.frames().find((candidate) => candidate.url().includes(artboardId)), initialFrame);
  assert.equal(await initialFrame.evaluate(() => innerWidth), 320);
  statuses.push("Selection, pan, zoom and UI drag observed; drag saved and iframe identity/CSS width stayed fixed");

  const updated = {
    projectId, commandId: randomUUID(), expectedRevision: 2,
    arguments: { artboardId, patch: {
      html: `<!-- <head> --><html><head data-test="yes"></head><body><h1>Prototype two</h1><img id="local" src="assets/local.png"><img src="${blocked}/network"><script>document.documentElement.dataset.executed='yes';</script><button onclick="document.documentElement.dataset.clicked='yes'">Test</button><link rel="preconnect" href="${blocked}"><link rel="dns-prefetch" href="${blocked}"><iframe src="${blocked}"></iframe><meta http-equiv="refresh" content="0;url=${blocked}"></body></html>`,
      css: `body{background:rgb(21,62,46);color:white}h1{font:28px system-ui}body::after{content:'';display:block;width:20px;height:20px;background:url(assets/missing.png)}`,
    } },
  };
  const commit = await data("update_artboard", updated);
  assert.equal(commit.revision, 3);
  const title = frame.getByRole("heading", { name: "Prototype two" });
  await title.waitFor();
  assert.equal(await title.evaluate((element) => getComputedStyle(element.ownerDocument.body).backgroundColor), "rgb(21, 62, 46)");
  const live = desktop.frames().find((candidate) => candidate.url().includes(artboardId));
  const security = await live.evaluate(() => {
    let parentAccess = false;
    try { void parent.document; parentAccess = true; } catch {}
    document.querySelector("button").click();
    return {
      bridge: typeof window.easyProto, require: typeof window.require, process: typeof window.process,
      parentAccess, scripts: document.scripts.length, hints: document.querySelectorAll("link[rel~=preconnect],link[rel~=dns-prefetch]").length,
      executed: document.documentElement.hasAttribute("data-executed"),
      clicked: document.documentElement.hasAttribute("data-clicked"),
      localWidth: document.querySelector("#local").naturalWidth,
      viewport: [innerWidth, innerHeight],
    };
  });
  assert.deepEqual(security, { bridge: "undefined", require: "undefined", process: "undefined", parentAccess: false,
    scripts: 0, hints: 0, executed: false, clicked: false, localWidth: 1, viewport: [320, 240] });
  assert.equal(connections, 0);
  assert.equal(await desktop.evaluate(() => typeof window.easyProto.getScene), "function");
  statuses.push("Updated HTML/CSS and local asset rendered; preview privilege probes and loopback traps stayed blocked");

  const captureArgs = { projectId, artboardId, revision: 3 };
  const capture = await client.callTool({ name: "capture_artboard", arguments: captureArgs });
  assert.equal(capture.isError, undefined, JSON.stringify(capture.content));
  const { structuredContent: details } = capture;
  assert.deepEqual([details.status, details.revision, details.sourceRevision, details.width, details.height], ["captured", 3, 3, 320, 240]);
  assert.equal(details.sourceDigest, commit.artboard.sourceDigest);
  assert.ok(details.unresolved.includes("Missing asset: missing.png"), JSON.stringify(details));
  assert.ok(details.unresolved.some((item) => item.includes("resource was blocked")), JSON.stringify(details));
  const png = Buffer.from(capture.content.find(({ type }) => type === "image").data, "base64");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [320, 240]);
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, "artboard.png"), png);
  }
  const sample = await app.evaluate(({ nativeImage }, encoded) => {
    const image = nativeImage.createFromBuffer(Buffer.from(encoded, "base64"));
    const pixels = image.toBitmap();
    return [...pixels.subarray(-4)];
  }, png.toString("base64"));
  assert.deepEqual(sample, [46, 62, 21, 255]);
  assert.equal(connections, 0);
  await failure("capture_artboard", { ...captureArgs, revision: 2 }, "REVISION_CONFLICT");
  statuses.push({ capture: details, pngSampleBGRA: sample });
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await desktop.getByRole("button", { name: /fit view/i }).click();
    await desktop.waitForTimeout(250);
    await desktop.screenshot({ path: join(evidence, "canvas.png"), animations: "disabled" });
  }

  await failure("update_artboard", { ...updated, commandId: randomUUID(), expectedRevision: 1 }, "REVISION_CONFLICT");
  await failure("create_artboard", { ...created, arguments: { ...created.arguments, name: "Reused ID" } }, "COMMAND_ID_REUSED");
  assert.equal((await data("get_artboard", { projectId, artboardId })).html, updated.arguments.patch.html);
  await close();
  await launch();
  const reopened = await data("get_artboard", { projectId, artboardId });
  assert.equal(reopened.revision, 3);
  assert.equal(reopened.html, updated.arguments.patch.html);
  assert.equal(reopened.css, updated.arguments.patch.css);
  assert.deepEqual([reopened.artboard.x, reopened.artboard.y, reopened.artboard.width, reopened.artboard.height],
    [moved.artboard.x, moved.artboard.y, 320, 240]);
  await desktop.frameLocator('iframe[title="Agent mockup"]').getByRole("heading", { name: "Prototype two" }).waitFor();
  assert.deepEqual(await data("create_artboard", created), initial);
  assert.deepEqual(await data("update_artboard", updated), commit);
  const context = await data("get_context");
  assert.equal(context.revision, 3);
  assert.equal(context.artboards.length, 2);
  const pointer = JSON.parse(await readFile(join(project, "project.json"), "utf8"));
  assert.equal(pointer.revision, 3);
  statuses.push("Stale/collision rejected; quit and reopen preserved layout and sources; exact retries replayed without new revisions");
});
