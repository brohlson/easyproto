import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  let app, client, desktop, activationId;
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
    const context = await client.callTool({ name: "get_context", arguments: {} });
    activationId = context.structuredContent.activationId;
    assert.match(activationId, /^[0-9a-f-]{36}$/);
    return endpoint;
  }

  const scope = (name, args) => name === "get_context" ? args : { activationId, ...args };
  const data = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: scope(name, args) });
    assert.equal(response.isError, undefined, JSON.stringify(response.content));
    return response.structuredContent;
  };
  const failure = async (name, args, code) => {
    const response = await client.callTool({ name, arguments: scope(name, args) });
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
  await writeFile(join(project, "assets", "invalid.png"), "synthetic undecodable image");
  const outside = join(root, "outside.png");
  await writeFile(outside, onePixel);
  await writeFile(join(project, "assets", "invalid.woff2"), "synthetic undecodable font");
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
    arguments: { name: "Agent mockup", width: 320, height: 240, x: 620, y: 40, html: "<h1>Prototype one</h1>", css: "body{background:#ddb}" },
  };
  const initial = await data("create_artboard", created);
  const artboardId = initial.artboard.id;
  assert.equal(initial.revision, 1);
  const frame = desktop.frameLocator('iframe[title="Agent mockup"]');
  await frame.getByRole("heading", { name: "Prototype one" }).waitFor();
  statuses.push("MCP create rendered its HTML in the live canvas");
  const board = desktop.locator(".react-flow__node").filter({ hasText: "Agent mockup" });
  await desktop.getByRole("button", { name: /fit view/i }).click();
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
  await desktop.evaluate(async () => {
    const viewport = document.querySelector(".react-flow__viewport");
    let last = "";
    let stable = 0;
    while (stable < 3) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const transform = viewport.style.transform;
      stable = transform === last ? stable + 1 : 0;
      last = transform;
    }
  });
  assert.equal(await initialFrame.evaluate(() => innerWidth), 320);
  const box = await board.boundingBox();
  const dragX = box.x + box.width / 2;
  const dragY = box.y + box.height / 2;
  await desktop.mouse.move(dragX, dragY);
  await desktop.mouse.down();
  await desktop.mouse.move(dragX - 44, dragY + 60, { steps: 8 });
  await desktop.mouse.up();
  await desktop.getByText("Saved · Revision 2", { exact: true }).waitFor({ timeout: 5000 });
  const dragged = await data("get_artboard", { projectId, artboardId });
  assert.notEqual(dragged.artboard.x, 620);
  assert.notEqual(dragged.artboard.y, 40);
  assert.equal(dragged.artboard.sourceRevision, 1);
  assert.equal(desktop.frames().find((candidate) => candidate.url().includes(artboardId)), initialFrame);
  assert.equal(await initialFrame.evaluate(() => innerWidth), 320);
  await board.press("ArrowRight");
  await desktop.getByText("Saved · Revision 3", { exact: true }).waitFor({ timeout: 5000 });
  const moved = await data("get_artboard", { projectId, artboardId });
  assert.equal(moved.artboard.x, dragged.artboard.x + 5);
  assert.equal(moved.artboard.y, dragged.artboard.y);
  assert.equal(desktop.frames().find((candidate) => candidate.url().includes(artboardId)), initialFrame);
  statuses.push("Selection, pan, zoom, drag and keyboard move observed; both moves saved without reloading or resizing the iframe");

  const updated = {
    projectId, commandId: randomUUID(), expectedRevision: 3,
    arguments: { artboardId, patch: {
      html: `<!-- <head> --><html><head data-test="yes"></head><body><h1>Prototype two</h1><img id="local" loading="lazy" src="assets/local.png"><img id="outside" src="file://${outside}"><img id="traversal" src="assets/%2e%2e/%2e%2e/outside.png"><img src="${blocked}/network"><a href="${blocked}/navigate" target="_blank">Link</a><script>document.documentElement.dataset.executed='yes';</script><button onclick="document.documentElement.dataset.clicked='yes'">Test</button><link rel="preconnect" href="${blocked}"><link rel="dns-prefetch" href="${blocked}"><iframe src="${blocked}"></iframe><meta http-equiv="refresh" content="0;url=${blocked}"></body></html>`,
      css: `@font-face{font-family:Fixture;src:url(assets/invalid.woff2)}body{background:rgb(21,62,46);color:white}body:has(img[loading=eager]){background:#f00}h1{font:28px Fixture,system-ui}body::after{content:'';display:block;width:20px;height:20px;background:url(assets/missing.png)}body::before{content:'';display:block;width:20px;height:20px;background:url(assets/invalid.png)}html{background-image:url(assets/query-only.png?v=1)}`,
    } },
  };
  const commit = await data("update_artboard", updated);
  assert.equal(commit.revision, 4);
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
      outsideWidth: document.querySelector("#outside").naturalWidth,
      traversalWidth: document.querySelector("#traversal").naturalWidth,
      viewport: [innerWidth, innerHeight],
    };
  });
  assert.deepEqual(security, { bridge: "undefined", require: "undefined", process: "undefined", parentAccess: false,
    scripts: 0, hints: 0, executed: false, clicked: false, localWidth: 1, outsideWidth: 0, traversalWidth: 0, viewport: [320, 240] });
  assert.equal(connections, 0);
  const originalUrl = live.url();
  await live.evaluate(() => document.querySelector("a").click());
  await title.waitFor();
  assert.equal(live.url(), originalUrl);
  assert.equal(await frame.getByText("Link", { exact: true }).getAttribute("href"), null);
  assert.equal(app.windows().length, 1);
  assert.equal(await desktop.evaluate(() => typeof window.easyProto.getScene), "function");
  statuses.push("Updated HTML/CSS and local asset rendered; preview privilege probes and loopback traps stayed blocked");

  await app.evaluate(({ app }) => {
    app.once("browser-window-created", (_event, window) => {
      const debug = window.webContents.debugger;
      const send = debug.sendCommand.bind(debug);
      debug.sendCommand = (command, params, ...args) => command === "Runtime.evaluate"
        ? send(command, {
            ...params,
            expression: `(async () => ({
              ...await (${params.expression}),
              captureBridge: typeof window.easyProto,
              captureRequire: typeof window.require,
              captureProcess: typeof window.process,
              captureOrigin: window.origin
            }))()`,
          }, ...args).then((report) => {
            globalThis.easyProtoCaptureProbe = {
              bridge: report.result.value.captureBridge,
              require: report.result.value.captureRequire,
              process: report.result.value.captureProcess,
              origin: report.result.value.captureOrigin,
            };
            return report;
          })
        : send(command, params, ...args);
    });
  });
  const captureArgs = { projectId, artboardId, revision: 4 };
  const capture = await client.callTool({ name: "capture_artboard", arguments: scope("capture_artboard", captureArgs) });
  assert.equal(capture.isError, undefined, JSON.stringify(capture.content));
  const { structuredContent: details } = capture;
  const captureIsolation = await app.evaluate(() => globalThis.easyProtoCaptureProbe);
  assert.deepEqual(captureIsolation, { bridge: "undefined", require: "undefined", process: "undefined", origin: "null" });
  assert.deepEqual([details.status, details.revision, details.sourceRevision, details.width, details.height], ["captured", 4, 4, 320, 240]);
  assert.equal(details.sourceDigest, commit.artboard.sourceDigest);
  assert.equal(details.media["prefers-reduced-motion"], await live.evaluate(() =>
    matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "no-preference"));
  assert.ok(details.devicePixelRatio >= 1);
  assert.ok(details.unresolved.includes("Missing asset: missing.png"), JSON.stringify(details));
  assert.ok(details.unresolved.includes("CSS image failed to decode: invalid.png"), JSON.stringify(details));
  assert.ok(details.unresolved.includes("CSS image failed to decode: query-only.png?v=1"), JSON.stringify(details));
  assert.ok(details.unresolved.some((item) => item.includes("Font could not load: Fixture")), JSON.stringify(details));
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
    const center = (120 * 320 + 160) * 4;
    return [...pixels.subarray(center, center + 4)];
  }, png.toString("base64"));
  assert.ok(sample.every((value, index) => Math.abs(value - [46, 62, 21, 255][index]) <= 2), String(sample));
  assert.equal(connections, 0);
  await failure("capture_artboard", { ...captureArgs, revision: 2 }, "REVISION_CONFLICT");
  statuses.push({ capture: details, captureIsolation, pngSampleBGRA: sample });
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await desktop.getByRole("button", { name: /fit view/i }).click();
    await desktop.waitForFunction(() => {
      const canvas = document.querySelector(".canvas").getBoundingClientRect();
      return [...document.querySelectorAll(".artboard-label")].every((label) => {
        const bounds = label.getBoundingClientRect();
        return bounds.top >= canvas.top && bounds.right <= canvas.right;
      });
    });
    await title.waitFor();
    await desktop.screenshot({ path: join(evidence, "canvas.png"), animations: "disabled" });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.isVisible()).setSize(660, 480));
    await desktop.waitForFunction(() => innerWidth === 660);
    await desktop.getByRole("button", { name: /fit view/i }).click();
    await desktop.waitForFunction(() => {
      const canvas = document.querySelector(".canvas").getBoundingClientRect();
      return [...document.querySelectorAll(".artboard-label")].every((label) => {
        const bounds = label.getBoundingClientRect();
        return bounds.top >= canvas.top && bounds.left >= canvas.left && bounds.right <= canvas.right;
      });
    });
    await title.waitFor();
    await desktop.screenshot({ path: join(evidence, "canvas-minimum.png"), animations: "disabled" });
  }

  await failure("update_artboard", { ...updated, commandId: randomUUID(), expectedRevision: 1 }, "REVISION_CONFLICT");
  await failure("create_artboard", { ...created, arguments: { ...created.arguments, name: "Reused ID" } }, "COMMAND_ID_REUSED");
  assert.equal((await data("get_artboard", { projectId, artboardId })).html, updated.arguments.patch.html);
  await close();
  await launch();
  const reopened = await data("get_artboard", { projectId, artboardId });
  assert.equal(reopened.revision, 4);
  assert.equal(reopened.html, updated.arguments.patch.html);
  assert.equal(reopened.css, updated.arguments.patch.css);
  assert.deepEqual([reopened.artboard.x, reopened.artboard.y, reopened.artboard.width, reopened.artboard.height],
    [moved.artboard.x, moved.artboard.y, 320, 240]);
  await desktop.frameLocator('iframe[title="Agent mockup"]').getByRole("heading", { name: "Prototype two" }).waitFor();
  assert.deepEqual(await data("create_artboard", created), initial);
  assert.deepEqual(await data("update_artboard", updated), commit);
  const context = await data("get_context");
  assert.equal(context.revision, 4);
  assert.equal(context.artboards.length, 2);
  const pointer = JSON.parse(await readFile(join(project, "project.json"), "utf8"));
  assert.equal(pointer.revision, 4);
  statuses.push("Stale/collision rejected; quit and reopen preserved layout and sources; exact retries replayed without new revisions");

  // Hold Chromium after frame readiness so a real MCP update can commit before the PNG is taken.
  await app.evaluate(({ app }) => {
    app.once("browser-window-created", (_event, window) => {
      const debug = window.webContents.debugger;
      const send = debug.sendCommand.bind(debug);
      debug.sendCommand = async (command, ...args) => {
        if (command === "Page.captureScreenshot") {
          await new Promise((release) => { globalThis.releaseEasyProtoCapture = release; });
        }
        return send(command, ...args);
      };
    });
  });
  const capturing = client.callTool({ name: "capture_artboard", arguments: scope("capture_artboard", captureArgs) });
  let overlap = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await app.evaluate(() => typeof globalThis.releaseEasyProtoCapture === "function")) {
      overlap = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  try {
    assert.ok(overlap, "Chromium capture did not reach the synchronization point.");
    const newer = await data("update_artboard", {
      projectId, commandId: randomUUID(), expectedRevision: 4,
      arguments: { artboardId, patch: { css: "body{background:#fa0}" } },
    });
    assert.equal(newer.revision, 5);
  } finally {
    await app.evaluate(() => {
      globalThis.releaseEasyProtoCapture?.();
      delete globalThis.releaseEasyProtoCapture;
    });
  }
  const pinned = await capturing;
  assert.equal(pinned.isError, undefined);
  assert.equal(pinned.structuredContent.revision, 4);
  assert.equal(pinned.structuredContent.sourceDigest, commit.artboard.sourceDigest);
  const pinnedPng = pinned.content.find(({ type }) => type === "image").data;
  const pinnedPixel = await app.evaluate(({ nativeImage }, encoded) => {
    const pixels = nativeImage.createFromBuffer(Buffer.from(encoded, "base64")).toBitmap();
    const center = (120 * 320 + 160) * 4;
    return [...pixels.subarray(center, center + 4)];
  }, pinnedPng);
  assert.ok(pinnedPixel.every((value, index) => Math.abs(value - sample[index]) <= 2), String(pinnedPixel));
  statuses.push("An actual capture paused before pixel read; concurrent MCP update committed revision 5 while the image retained revision 4 and its pixels.");

  const nested = "<div>".repeat(160) + '<span id="deep-marker">Beyond preview depth</span>' + "</div>".repeat(160);
  const deep = await data("update_artboard", {
    projectId, commandId: randomUUID(), expectedRevision: 5,
    arguments: { artboardId, patch: { html: '<h1>Deep preview</h1>' + nested } },
  });
  const deepFrame = desktop.frameLocator('iframe[title="Agent mockup"]');
  await deepFrame.getByRole("heading", { name: "Deep preview" }).waitFor();
  assert.equal(await deepFrame.locator("#deep-marker").count(), 0);
  assert.equal(deep.revision, 6);
  assert.equal((await data("get_artboard", { projectId, artboardId })).html, '<h1>Deep preview</h1>' + nested);
  const deepCapture = await client.callTool({ name: "capture_artboard", arguments: scope("capture_artboard", { projectId, artboardId, revision: 6 }) });
  assert.equal(deepCapture.isError, undefined, JSON.stringify(deepCapture.content));
  assert.equal(deepCapture.structuredContent.sourceDigest, deep.artboard.sourceDigest);
  await app.evaluate(({ app }) => {
    app.once("browser-window-created", (_event, window) => {
      const debug = window.webContents.debugger;
      const send = debug.sendCommand.bind(debug);
      debug.sendCommand = (command, ...args) => command === "Runtime.evaluate"
        ? new Promise(() => {}) : send(command, ...args);
    });
  });
  await failure("capture_artboard", { projectId, artboardId, revision: 6 }, "RENDER_TIMEOUT");
  assert.equal((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)), 1);
  await close();
  await launch();
  await desktop.frameLocator('iframe[title="Agent mockup"]').getByRole("heading", { name: "Deep preview" }).waitFor();
  assert.equal((await data("get_context")).revision, 6);
  statuses.push("Deep markup stayed bounded in preview, capture and reopen. Canonical source stayed intact and MCP responded.");
  statuses.push("Injected readiness timeout was reported and disposed its capture window.");

  const lost = {
    projectId, commandId: randomUUID(), expectedRevision: 6,
    arguments: { ...created.arguments, name: "Lost reply mockup", x: 620, y: 360 },
  };
  const aborted = new AbortController();
  const cutoff = new Client({ name: "disposable-lost-reply-client", version: "1.0.0" });
  await cutoff.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: "Bearer " + token } },
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (typeof init?.body !== "string" || !init.body.includes(lost.commandId)) return response;
      await response.body?.cancel();
      aborted.abort();
      throw new Error("Synthetic lost MCP reply");
    },
  }));
  await assert.rejects(cutoff.callTool({ name: "create_artboard", arguments: scope("create_artboard", lost) }, undefined, { signal: aborted.signal }));
  await cutoff.close();
  assert.equal((await data("get_context")).revision, 7);
  await close();
  await launch();
  const commitFromDisk = await data("create_artboard", lost);
  assert.equal(commitFromDisk.revision, 7);
  assert.equal((await data("get_context")).artboards.filter((board) => board.name === "Lost reply mockup").length, 1);
  await desktop.frameLocator('iframe[title="Lost reply mockup"]').getByRole("heading", { name: "Prototype one" }).waitFor();
  statuses.push("A second MCP-created board's reply was discarded at the SDK transport. Restart and retry recovered the original board and revision.");

  const original = await data("get_context");
  const originalScene = await desktop.evaluate(() => window.easyProto.getScene());
  const another = join(root, "Fresh project");
  const invalid = join(root, "Invalid project");
  const copy = join(root, "Project copy");
  await mkdir(another);
  await mkdir(invalid);
  await cp(project, copy, { recursive: true });

  // Supply disposable choices at Electron's native dialog boundary while clicking the actual desktop buttons.
  async function choose(action, folder, error) {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async (parent, options) => {
        globalThis.easyProtoPicker = { parent: parent.isVisible(), options };
        return folder ? { canceled: false, filePaths: [folder] } : { canceled: true, filePaths: [] };
      };
    }, folder);
    const control = desktop.getByRole("button", { name: action, exact: true });
    await control.click();
    await desktop.waitForFunction(() => [...document.querySelectorAll(".project-actions button")].every((button) => !button.disabled));
    const picker = await app.evaluate(() => globalThis.easyProtoPicker);
    assert.equal(picker.parent, true);
    assert.equal(picker.options.title, action);
    assert.ok(picker.options.properties.includes("openDirectory"));
    assert.equal(picker.options.properties.includes("createDirectory"), action === "New Project");
    if (error) {
      const alert = desktop.getByRole("alert");
      assert.match(await alert.innerText(), error);
      await alert.getByRole("button", { name: "Dismiss" }).click();
    }
    return data("get_context");
  }

  assert.deepEqual(await choose("Open Project", null), original);
  assert.deepEqual(await choose("Open Project", invalid, /Could not open/), original);
  await assert.rejects(readFile(join(invalid, "project.json")), { code: "ENOENT" });
  assert.deepEqual(await choose("New Project", project, /Could not create/), original);
  assert.equal((await desktop.evaluate(() => window.easyProto.getScene())).generation, originalScene.generation);
  statuses.push("Cancel and invalid choices retained the current canvas and MCP scope. Open did not initialize an empty folder; New refused an existing project.");

  const fresh = await choose("New Project", another);
  assert.notEqual(fresh.projectId, projectId);
  assert.notEqual(fresh.activationId, original.activationId);
  assert.equal(fresh.revision, 0);
  await desktop.getByText("Fresh project", { exact: true }).waitFor();
  await desktop.getByText("Saved · Revision 0", { exact: true }).waitFor();
  await desktop.frameLocator('iframe[title="Field notes"]').getByRole("heading", { name: "Make room for ideas." }).waitFor();
  assert.equal(JSON.parse(await readFile(join(another, "project.json"), "utf8")).projectId, fresh.projectId);
  assert.equal(await desktop.locator('iframe[title="Agent mockup"]').count(), 0);
  await failure("get_artboard", { projectId, activationId: original.activationId, artboardId }, "PROJECT_SCOPE");

  const branch = await choose("Open Project", copy);
  assert.equal(branch.projectId, projectId);
  assert.notEqual(branch.activationId, original.activationId);
  assert.equal(branch.revision, 7);
  const branchEdit = {
    projectId, activationId: branch.activationId, expectedRevision: 7, commandId: randomUUID(),
    arguments: { artboardId, patch: { html: "<h1>Copy only</h1>" } },
  };
  await data("update_artboard", branchEdit);
  await desktop.frameLocator('iframe[title="Agent mockup"]').getByRole("heading", { name: "Copy only" }).waitFor();

  const returned = await choose("Open Project", project);
  assert.equal(returned.revision, 7);
  assert.notEqual(returned.activationId, original.activationId);
  await data("update_artboard", {
    ...branchEdit, activationId: returned.activationId, commandId: randomUUID(),
    arguments: { artboardId, patch: { html: "<h1>Original only</h1>" } },
  });
  await desktop.frameLocator('iframe[title="Agent mockup"]').getByRole("heading", { name: "Original only" }).waitFor();
  const beforeSwitch = await desktop.evaluate(() => window.easyProto.getScene());
  const previousUrl = beforeSwitch.artboards.find((board) => board.id === artboardId).previewUrl;

  await app.evaluate(({ app }) => {
    app.once("browser-window-created", (_event, window) => {
      const debug = window.webContents.debugger;
      const send = debug.sendCommand.bind(debug);
      debug.sendCommand = (command, ...args) => {
        if (command !== "Page.captureScreenshot") return send(command, ...args);
        globalThis.pickerCaptureStarted = true;
        return new Promise((_resolve, reject) => window.once("closed", () => reject(new Error("Capture window closed"))));
      };
    });
  });
  const oldScope = { projectId, artboardId, activationId: returned.activationId };
  const pending = client.callTool({ name: "capture_artboard", arguments: { ...oldScope, revision: 8 } });
  for (let attempt = 0; attempt < 150 && !await app.evaluate(() => globalThis.pickerCaptureStarted); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.equal(await app.evaluate(() => globalThis.pickerCaptureStarted), true);
  const switched = await choose("Open Project", copy);
  assert.equal(switched.projectId, projectId);
  assert.equal(switched.revision, 8);
  assert.notEqual(switched.activationId, returned.activationId);
  assert.equal(switched.assetDigest, branch.assetDigest);
  await desktop.frameLocator('iframe[title="Agent mockup"]').getByRole("heading", { name: "Copy only" }).waitFor();
  const retired = await pending;
  assert.equal(retired.structuredContent.code, "PROJECT_SCOPE");
  assert.equal(retired.content.some(({ type }) => type === "image"), false);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);

  for (const [tool, args] of [
    ["get_artboard", oldScope],
    ["capture_artboard", { ...oldScope, revision: 8 }],
    ["create_artboard", { projectId, activationId: oldScope.activationId, expectedRevision: 8, commandId: randomUUID(), arguments: created.arguments }],
    ["update_artboard", { ...branchEdit, activationId: oldScope.activationId, expectedRevision: 8, commandId: randomUUID() }],
  ]) await failure(tool, args, "PROJECT_SCOPE");
  const oldStatus = await app.evaluate(({ BrowserWindow }, url) =>
    BrowserWindow.getAllWindows()[0].webContents.session.fetch(url).then((response) => response.status), previousUrl);
  assert.equal(oldStatus, 404);
  await assert.rejects(desktop.evaluate(({ generation, projectId, artboardId, commandId }) =>
    window.easyProto.moveArtboard(generation, {
      projectId, commandId, expectedRevision: 8, operation: "update_artboard", arguments: { artboardId, patch: { x: 5 } },
    }), { generation: beforeSwitch.generation, projectId, artboardId, commandId: randomUUID() }), /project selection changed/i);
  assert.equal((await data("get_artboard", { ...oldScope, activationId: switched.activationId })).html, "<h1>Copy only</h1>");
  assert.equal((await data("update_artboard", { ...branchEdit, activationId: switched.activationId })).revision, 8);
  assert.equal((await data("get_context")).revision, 8);
  const freshCapture = await client.callTool({
    name: "capture_artboard", arguments: { ...oldScope, activationId: switched.activationId, revision: 8 },
  });
  assert.equal(freshCapture.isError, undefined);
  assert.ok(freshCapture.content.some(({ type }) => type === "image"));
  // Pause a real commit at publication, then reopen the same folder while its writer is active.
  await app.evaluate(() => {
    const fs = process.getBuiltinModule("node:fs/promises");
    const { syncBuiltinESMExports } = process.getBuiltinModule("node:module");
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      if (String(to).endsWith("/project.json")) {
        await new Promise((resolve) => { globalThis.releasePickerCommit = resolve; });
        fs.rename = rename;
        syncBuiltinESMExports();
      }
      return rename(from, to);
    };
    syncBuiltinESMExports();
  });
  const pendingEdit = {
    ...branchEdit, activationId: switched.activationId, expectedRevision: 8, commandId: randomUUID(),
    arguments: { artboardId, patch: { html: "<h1>Saved before reopen</h1>" } },
  };
  const pendingSave = client.callTool({ name: "update_artboard", arguments: pendingEdit });
  let reopening;
  try {
    for (let attempt = 0; attempt < 150 && !await app.evaluate(() => Boolean(globalThis.releasePickerCommit)); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    assert.equal(await app.evaluate(() => Boolean(globalThis.releasePickerCommit)), true);
    reopening = choose("Open Project", copy);
    await desktop.getByText("Selecting project…", { exact: true }).waitFor({ timeout: 5000 });
    assert.equal((await data("get_context")).activationId, switched.activationId);
    await failure("update_artboard", { ...branchEdit, activationId: switched.activationId }, "PROJECT_SWITCHING");
  } finally {
    await app.evaluate(() => {
      globalThis.releasePickerCommit?.();
      delete globalThis.releasePickerCommit;
    });
  }
  const savedBeforeSwitch = await pendingSave;
  assert.equal(savedBeforeSwitch.structuredContent.revision, 9);
  const reopenedCopy = await reopening;
  assert.notEqual(reopenedCopy.activationId, switched.activationId);
  assert.equal(reopenedCopy.revision, 9);
  await desktop.frameLocator('iframe[title="Agent mockup"]').getByRole("heading", { name: "Saved before reopen" }).waitFor();
  assert.equal((await data("update_artboard", { ...pendingEdit, activationId: reopenedCopy.activationId })).revision, 9);
  statuses.push("A same-folder reopen waited for an admitted MCP save paused at publication, then loaded revision 9 and replayed that command under fresh scope.");

  statuses.push("New started revision zero and Open restored saved work. The same connected SDK client discovered fresh authority for a divergent same-ID copy.");
  statuses.push("The retired activation could neither read, capture, create nor update. A pending capture returned no image; its old live URL returned 404 and stale renderer moves were rejected. Fresh scope read, captured and replayed a prior commit.");
  if (evidence) {
    await desktop.screenshot({ path: join(evidence, "project-picker-canvas.png"), animations: "disabled" });
  }
});
