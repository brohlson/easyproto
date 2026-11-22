import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { _electron as electron } from "playwright";

const onePixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
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

async function pinchCanvas(page, deltaY) {
  const { x, y, width, height } = await page.locator(".canvas").boundingBox();
  await page.mouse.move(x + width / 2, y + height / 2);
  // Chromium delivers a trackpad pinch as a wheel event with Ctrl set.
  await page.keyboard.down("Control");
  try {
    await page.mouse.wheel(0, deltaY);
  } finally {
    await page.keyboard.up("Control");
  }
}

const fitCanvas = (page) => page.keyboard.press("Shift+Digit0");

async function waitForRevision(page, revision) {
  const deadline = Date.now() + 5000;
  do {
    const scene = await page.evaluate(() => window.easyProto.getScene());
    if (scene.revision === revision) return scene;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.fail(`Project did not reach revision ${revision}`);
}

test(
  "macOS Electron and real MCP client exercise the complete desktop slice",
  { timeout: 85_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "easy-proto-smoke-"));
    const project = join(root, "Test project");
    const token = randomBytes(32).toString("base64url");
    const trap = createServer((_request, response) => response.end());
    let connections = 0;
    trap.on("connection", () => {
      connections++;
    });
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
          await writeFile(
            join(evidence, "desktop-stages.json"),
            JSON.stringify({ statuses, logs }, null, 2),
          );
        }
        await rm(root, { recursive: true, force: true });
      }
    });

    async function launch() {
      app = await electron.launch({
        args: [process.cwd(), `--project=${project}`],
        env: {
          ...process.env,
          EASY_PROTO_PROFILE: join(root, "profile"),
          EASY_PROTO_TOKEN: token,
          EASY_PROTO_PORT: String(port),
        },
        timeout: 20_000,
      });
      desktop = await app.firstWindow();
      for (const stream of [app.process().stdout, app.process().stderr])
        stream.on("data", (data) => logs.push(data.toString()));
      await desktop
        .frameLocator('iframe[title="Field notes"]')
        .getByRole("heading", { name: "Make room for ideas." })
        .waitFor({ timeout: 8000 });
      client = new Client({ name: "easy-proto-integration", version: "1.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(endpoint), {
          requestInit: { headers: { Authorization: "Bearer " + token } },
        }),
      );
      const context = await client.callTool({ name: "get_context", arguments: {} });
      activationId = context.structuredContent.activationId;
      assert.match(activationId, /^[0-9a-f-]{36}$/);
      return endpoint;
    }

    const waitForDesktopRevision = (revision) => waitForRevision(desktop, revision);
    const settings = () => desktop.getByRole("button", { name: "Settings", exact: true });
    const openSettings = async () => {
      if (!(await desktop.locator("#settings").isVisible())) await settings().click();
    };
    const setAppearance = async (theme) => {
      await openSettings();
      const label = { light: "Light", dark: "Dark", system: "System" }[theme];
      await desktop
        .getByRole("group", { name: "Appearance" })
        .getByRole("button", { name: label })
        .click();
      await desktop.locator("#settings").waitFor({ state: "hidden" });
    };

    const scope = (name, args) => (name === "get_context" ? args : { activationId, ...args });
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
    assert.equal(
      await raw(url, { headers: { ...auth, host: "localhost:" + new URL(url).port } }),
      403,
    );
    assert.equal(await raw(url, { headers: auth }, " ".repeat(3 * 1024 * 1024 + 1)), 413);
    const protocolHeader = await raw(
      url,
      {
        headers: {
          ...auth,
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
        },
      },
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    );
    assert.equal(protocolHeader, 200);
    const list = await client.listTools();
    assert.deepEqual(list.tools.map(({ name }) => name).sort(), [
      "capture_artboard",
      "create_artboard",
      "delete_page",
      "get_artboard",
      "get_context",
      "get_tokens",
      "replace_project_tokens",
      "set_artboard_activity",
      "update_artboard",
    ]);
    const { projectId, revision } = await data("get_context");
    statuses.push({
      electron: await app.evaluate(() => process.versions.electron),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    });
    assert.equal(revision, 0);
    await failure(
      "get_artboard",
      { projectId: randomUUID(), artboardId: randomUUID() },
      "PROJECT_SCOPE",
    );
    statuses.push("SDK discovery, bearer, Host, Origin, body bound and project scope verified");

    const created = {
      projectId,
      expectedRevision: 0,
      commandId: randomUUID(),
      arguments: {
        name: "Agent mockup",
        width: 320,
        height: 240,
        x: 620,
        y: 40,
        html: "<h1>Prototype one</h1>",
        css: "body{background:#ddb}",
      },
    };
    const initial = await data("create_artboard", created);
    const artboardId = initial.artboard.id;
    assert.equal(initial.revision, 1);
    const frame = desktop.frameLocator('iframe[title="Agent mockup"]');
    await frame.getByRole("heading", { name: "Prototype one" }).waitFor();
    statuses.push("MCP create rendered its HTML in the live canvas");
    const board = desktop.locator(".react-flow__node").filter({ hasText: "Agent mockup" });
    await fitCanvas(desktop);
    const initialFrame = desktop.frames().find((candidate) => candidate.url().includes(artboardId));
    await board.click({ position: { x: 60, y: 60 } });
    assert.ok((await board.getAttribute("class")).includes("selected"));
    const canvasTransform = async () =>
      desktop.locator(".react-flow__viewport").getAttribute("style");
    const beforePan = await canvasTransform();
    const canvas = await desktop.locator(".react-flow__pane").boundingBox();
    await desktop.mouse.move(canvas.x + 40, canvas.y + 45);
    await desktop.keyboard.down("Space");
    await desktop.mouse.down();
    await desktop.mouse.move(canvas.x + 90, canvas.y + 73, { steps: 5 });
    await desktop.mouse.up();
    await desktop.keyboard.up("Space");
    if (beforePan === (await canvasTransform()))
      throw new Error("Canvas pan did not change the viewport.");

    const viewport = desktop.locator(".react-flow__viewport");
    const view = () =>
      viewport.evaluate((element) => {
        const { m41: x, m42: y, a: scale } = new DOMMatrix(element.style.transform);
        return { x, y, scale };
      });
    async function scrollPan(dx, dy) {
      const before = await canvasTransform();
      await desktop.mouse.wheel(dx, dy);
      await desktop.waitForFunction(
        (before) =>
          document.querySelector(".react-flow__viewport").getAttribute("style") !== before,
        before,
      );
      return view();
    }
    const boardBox = await board.boundingBox();
    await desktop.mouse.move(boardBox.x + boardBox.width / 2, boardBox.y + boardBox.height / 2);
    const beforeSwipe = await view();
    const horizontal = await scrollPan(64, 0);
    assert.ok(horizontal.x < beforeSwipe.x);
    assert.equal(horizontal.y, beforeSwipe.y);
    assert.equal(horizontal.scale, beforeSwipe.scale);
    const vertical = await scrollPan(0, 48);
    assert.equal(vertical.x, horizontal.x);
    assert.ok(vertical.y < horizontal.y);
    assert.equal(vertical.scale, beforeSwipe.scale);
    await scrollPan(-64, -48);

    const beforeZoom = await canvasTransform();
    await pinchCanvas(desktop, -10);
    await desktop.waitForFunction(
      (before) => document.querySelector(".react-flow__viewport").getAttribute("style") !== before,
      beforeZoom,
    );
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
    const afterPinch = await view();
    assert.ok(afterPinch.scale > beforeSwipe.scale);
    statuses.push({ beforeSwipe, horizontal, vertical, afterPinch });
    assert.equal(await initialFrame.evaluate(() => innerWidth), 320);
    const box = await board.boundingBox();
    const dragX = box.x + box.width / 2;
    const dragY = box.y + box.height / 2;
    await desktop.mouse.move(dragX, dragY);
    await desktop.mouse.down();
    await desktop.mouse.move(dragX - 44, dragY + 60, { steps: 8 });
    await desktop.mouse.up();
    await waitForDesktopRevision(2);
    const dragged = await data("get_artboard", { projectId, artboardId });
    assert.notEqual(dragged.artboard.x, 620);
    assert.notEqual(dragged.artboard.y, 40);
    assert.equal(dragged.artboard.sourceRevision, 1);
    assert.equal(
      desktop.frames().find((candidate) => candidate.url().includes(artboardId)),
      initialFrame,
    );
    assert.equal(await initialFrame.evaluate(() => innerWidth), 320);
    await board.press("ArrowRight");
    await waitForDesktopRevision(3);
    const moved = await data("get_artboard", { projectId, artboardId });
    assert.equal(moved.artboard.x, dragged.artboard.x + 5);
    assert.equal(moved.artboard.y, dragged.artboard.y);
    assert.equal(
      desktop.frames().find((candidate) => candidate.url().includes(artboardId)),
      initialFrame,
    );
    statuses.push(
      "Swipe-equivalent wheel input panned on both axes without scaling. Pinch-equivalent input zoomed. Drag and keyboard movement saved without reloading or resizing the iframe.",
    );

    const updated = {
      projectId,
      commandId: randomUUID(),
      expectedRevision: 3,
      arguments: {
        artboardId,
        patch: {
          html: `<!-- <head> --><html><head data-test="yes"></head><body><h1>Prototype two</h1><img id="local" loading="lazy" src="assets/local.png"><img id="outside" src="file://${outside}"><img id="traversal" src="assets/%2e%2e/%2e%2e/outside.png"><img src="${blocked}/network"><a href="${blocked}/navigate" target="_blank">Link</a><script>document.documentElement.dataset.executed='yes';</script><button onclick="document.documentElement.dataset.clicked='yes'">Test</button><link rel="preconnect" href="${blocked}"><link rel="dns-prefetch" href="${blocked}"><iframe src="${blocked}"></iframe><meta http-equiv="refresh" content="0;url=${blocked}"></body></html>`,
          css: `@font-face{font-family:Fixture;src:url(assets/invalid.woff2)}body{background:rgb(21,62,46);color:white}body:has(img[loading=eager]){background:#f00}h1{font:28px Fixture,system-ui}body::after{content:'';display:block;width:20px;height:20px;background:url(assets/missing.png)}body::before{content:'';display:block;width:20px;height:20px;background:url(assets/invalid.png)}html{background-image:url(assets/query-only.png?v=1)}`,
        },
      },
    };
    const commit = await data("update_artboard", updated);
    assert.equal(commit.revision, 4);
    const title = frame.getByRole("heading", { name: "Prototype two" });
    await title.waitFor();
    assert.equal(
      await title.evaluate(
        (element) => getComputedStyle(element.ownerDocument.body).backgroundColor,
      ),
      "rgb(21, 62, 46)",
    );
    const live = desktop.frames().find((candidate) => candidate.url().includes(artboardId));
    const security = await live.evaluate(() => {
      let parentAccess = false;
      try {
        void parent.document;
        parentAccess = true;
      } catch {}
      document.querySelector("button").click();
      return {
        bridge: typeof window.easyProto,
        require: typeof window.require,
        process: typeof window.process,
        parentAccess,
        scripts: document.scripts.length,
        hints: document.querySelectorAll("link[rel~=preconnect],link[rel~=dns-prefetch]").length,
        executed: document.documentElement.hasAttribute("data-executed"),
        clicked: document.documentElement.hasAttribute("data-clicked"),
        localWidth: document.querySelector("#local").naturalWidth,
        outsideWidth: document.querySelector("#outside").naturalWidth,
        traversalWidth: document.querySelector("#traversal").naturalWidth,
        viewport: [innerWidth, innerHeight],
      };
    });
    assert.deepEqual(security, {
      bridge: "undefined",
      require: "undefined",
      process: "undefined",
      parentAccess: false,
      scripts: 0,
      hints: 0,
      executed: false,
      clicked: false,
      localWidth: 1,
      outsideWidth: 0,
      traversalWidth: 0,
      viewport: [320, 240],
    });
    assert.equal(connections, 0);
    const originalUrl = live.url();
    await live.evaluate(() => document.querySelector("a").click());
    await title.waitFor();
    assert.equal(live.url(), originalUrl);
    assert.equal(await frame.getByText("Link", { exact: true }).getAttribute("href"), null);
    assert.equal(app.windows().length, 1);
    assert.equal(await desktop.evaluate(() => typeof window.easyProto.getScene), "function");
    statuses.push(
      "Updated HTML/CSS and local asset rendered; preview privilege probes and loopback traps stayed blocked",
    );

    await app.evaluate(({ app }) => {
      app.once("browser-window-created", (_event, window) => {
        const debug = window.webContents.debugger;
        const send = debug.sendCommand.bind(debug);
        debug.sendCommand = (command, params, ...args) =>
          command === "Runtime.evaluate"
            ? send(
                command,
                {
                  ...params,
                  expression: `(async () => ({
              ...await (${params.expression}),
              captureBridge: typeof window.easyProto,
              captureRequire: typeof window.require,
              captureProcess: typeof window.process,
              captureOrigin: window.origin
            }))()`,
                },
                ...args,
              ).then((report) => {
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
    const capture = await client.callTool({
      name: "capture_artboard",
      arguments: scope("capture_artboard", captureArgs),
    });
    assert.equal(capture.isError, undefined, JSON.stringify(capture.content));
    const { structuredContent: details } = capture;
    const captureIsolation = await app.evaluate(() => globalThis.easyProtoCaptureProbe);
    assert.deepEqual(captureIsolation, {
      bridge: "undefined",
      require: "undefined",
      process: "undefined",
      origin: "null",
    });
    assert.deepEqual(
      [details.status, details.revision, details.sourceRevision, details.width, details.height],
      ["captured", 4, 4, 320, 240],
    );
    assert.equal(details.sourceDigest, commit.artboard.sourceDigest);
    assert.equal(
      details.media["prefers-reduced-motion"],
      await live.evaluate(() =>
        matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "no-preference",
      ),
    );
    assert.ok(details.devicePixelRatio >= 1);
    assert.ok(details.unresolved.includes("Missing asset: missing.png"), JSON.stringify(details));
    assert.ok(
      details.unresolved.includes("CSS image failed to decode: invalid.png"),
      JSON.stringify(details),
    );
    assert.ok(
      details.unresolved.includes("CSS image failed to decode: query-only.png?v=1"),
      JSON.stringify(details),
    );
    assert.ok(
      details.unresolved.some((item) => item.includes("Font could not load: Fixture")),
      JSON.stringify(details),
    );
    assert.ok(
      details.unresolved.some((item) => item.includes("resource was blocked")),
      JSON.stringify(details),
    );
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
    assert.ok(
      sample.every((value, index) => Math.abs(value - [46, 62, 21, 255][index]) <= 2),
      String(sample),
    );
    assert.equal(connections, 0);
    await failure("capture_artboard", { ...captureArgs, revision: 2 }, "REVISION_CONFLICT");
    statuses.push({ capture: details, captureIsolation, pngSampleBGRA: sample });
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await fitCanvas(desktop);
      await desktop.waitForFunction(() => {
        const canvas = document.querySelector(".canvas").getBoundingClientRect();
        return [...document.querySelectorAll(".artboard-label")].every((label) => {
          const bounds = label.getBoundingClientRect();
          return bounds.top >= canvas.top && bounds.right <= canvas.right;
        });
      });
      await title.waitFor();
      await desktop.screenshot({ path: join(evidence, "canvas.png"), animations: "disabled" });
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.isVisible())
          .setSize(660, 480),
      );
      await desktop.waitForFunction(() => innerWidth === 660);
      await fitCanvas(desktop);
      await desktop.waitForFunction(() => {
        const canvas = document.querySelector(".canvas").getBoundingClientRect();
        return [...document.querySelectorAll(".artboard-label")].every((label) => {
          const bounds = label.getBoundingClientRect();
          return (
            bounds.top >= canvas.top && bounds.left >= canvas.left && bounds.right <= canvas.right
          );
        });
      });
      await title.waitFor();
      await desktop.screenshot({
        path: join(evidence, "canvas-minimum.png"),
        animations: "disabled",
      });
    }

    await failure(
      "update_artboard",
      { ...updated, commandId: randomUUID(), expectedRevision: 1 },
      "REVISION_CONFLICT",
    );
    await failure(
      "create_artboard",
      { ...created, arguments: { ...created.arguments, name: "Reused ID" } },
      "COMMAND_ID_REUSED",
    );
    assert.equal(
      (await data("get_artboard", { projectId, artboardId })).html,
      updated.arguments.patch.html,
    );
    await close();
    await launch();
    const reopened = await data("get_artboard", { projectId, artboardId });
    assert.equal(reopened.revision, 4);
    assert.equal(reopened.html, updated.arguments.patch.html);
    assert.equal(reopened.css, updated.arguments.patch.css);
    assert.deepEqual(
      [reopened.artboard.x, reopened.artboard.y, reopened.artboard.width, reopened.artboard.height],
      [moved.artboard.x, moved.artboard.y, 320, 240],
    );
    await desktop
      .frameLocator('iframe[title="Agent mockup"]')
      .getByRole("heading", { name: "Prototype two" })
      .waitFor();
    assert.deepEqual(await data("create_artboard", created), initial);
    assert.deepEqual(await data("update_artboard", updated), commit);
    const context = await data("get_context");
    assert.equal(context.revision, 4);
    assert.equal(context.artboards.length, 2);
    const pointer = JSON.parse(await readFile(join(project, "project.json"), "utf8"));
    assert.equal(pointer.revision, 4);
    statuses.push(
      "Stale/collision rejected; quit and reopen preserved layout and sources; exact retries replayed without new revisions",
    );

    const activityScope = { projectId, artboardId, activityId: randomUUID() };
    const parallelActivity = { ...activityScope, activityId: randomUUID() };
    const setActivity = (status, scope = activityScope) =>
      data("set_artboard_activity", { ...scope, status });
    const activityLabel = () => desktop.getByRole("status").filter({ hasText: "Agent working" });
    const activeLabel = () => activityLabel().filter({ hasText: "Agent working on Agent mockup" });
    const activityFrame = desktop.frames().find((frame) => frame.url().includes(artboardId));
    const activityDocument = await activityFrame.locator("html").elementHandle();
    assert.equal((await setActivity("working")).expiresInMs, 120_000);
    await activeLabel().waitFor();
    assert.equal(await activityLabel().count(), 1);
    const preview = desktop.locator(`[data-id="${artboardId}"] iframe`);
    assert.equal(await desktop.locator(".artboard-preview-working").count(), 1);
    assert.deepEqual(
      await preview.evaluate((element) => {
        const [pulse] = element.getAnimations();
        pulse.pause();
        return [0, 1500, 3000].map((time) => {
          pulse.currentTime = time;
          return getComputedStyle(element).opacity;
        });
      }),
      ["1", "0.8", "1"],
    );
    assert.equal(await activeLabel().evaluate((label) => getComputedStyle(label).opacity), "1");
    const dots = activeLabel().locator(".activity-dots > span");
    assert.deepEqual(
      await dots.evaluateAll((elements) =>
        elements.map((dot) => [
          getComputedStyle(dot).animationName,
          getComputedStyle(dot).animationDelay,
        ]),
      ),
      [
        ["activity-dot", "0s"],
        ["activity-dot", "0.16s"],
        ["activity-dot", "0.32s"],
      ],
    );
    await desktop.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await preview.evaluate((element) => element.getAnimations().length), 0);
    assert.equal(await preview.evaluate((element) => getComputedStyle(element).opacity), "1");
    assert.deepEqual(
      await dots.evaluateAll((elements) =>
        elements.map((dot) => getComputedStyle(dot).animationName),
      ),
      ["none", "none", "none"],
    );
    await activeLabel().waitFor();
    await desktop.emulateMedia({ reducedMotion: "no-preference" });
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await preview.evaluate((element) => {
        const [pulse] = element.getAnimations();
        pulse.pause();
        pulse.currentTime = 1500;
      });
      await desktop.screenshot({ path: join(evidence, "artboard-activity.png") });
      await setAppearance("dark");
      await desktop.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await desktop.screenshot({ path: join(evidence, "artboard-activity-dark.png") });
      await setAppearance("system");
    }
    assert.equal((await setActivity("working")).working, true);
    assert.equal((await setActivity("working", parallelActivity)).working, true);
    assert.equal((await setActivity("idle")).working, true);
    assert.equal((await setActivity("idle")).working, true);
    await activeLabel().waitFor();
    await failure(
      "set_artboard_activity",
      { ...activityScope, artboardId: randomUUID(), status: "working" },
      "ARTBOARD_NOT_FOUND",
    );
    assert.equal((await setActivity("idle", parallelActivity)).working, false);
    await activeLabel().waitFor({ state: "hidden" });
    assert.equal(await desktop.locator(".artboard-preview-working").count(), 0);
    assert.equal(await preview.evaluate((element) => getComputedStyle(element).opacity), "1");
    assert.equal(
      await activityDocument.evaluate((element) => element === document.documentElement),
      true,
    );
    assert.equal((await data("get_context")).revision, 4);
    assert.deepEqual(JSON.parse(await readFile(join(project, "project.json"), "utf8")), pointer);
    statuses.push(
      "Explicit activity pulsed only its artboard between 100% and 80% opacity, respected reduced motion, overlapped independently, and left its iframe and project pointer intact.",
    );

    // Accelerate only the main process lease timer to observe abandoned activity cleanup.
    await app.evaluate(() => {
      const original = globalThis.setTimeout;
      globalThis.setTimeout = (callback, delay, ...args) => {
        if (delay !== 120_000) return original(callback, delay, ...args);
        globalThis.setTimeout = original;
        return original(callback, 1_000, ...args);
      };
    });
    await setActivity("working");
    await activeLabel().waitFor();
    await activeLabel().waitFor({ state: "hidden", timeout: 5_000 });
    statuses.push("An abandoned activity expired and cleared from the canvas.");

    // Hold Chromium after frame readiness so a real MCP update can commit before the PNG is taken.
    await app.evaluate(({ app }) => {
      app.once("browser-window-created", (_event, window) => {
        const debug = window.webContents.debugger;
        const send = debug.sendCommand.bind(debug);
        debug.sendCommand = async (command, ...args) => {
          if (command === "Page.captureScreenshot") {
            await new Promise((release) => {
              globalThis.releaseEasyProtoCapture = release;
            });
          }
          return send(command, ...args);
        };
      });
    });
    const capturing = client.callTool({
      name: "capture_artboard",
      arguments: scope("capture_artboard", captureArgs),
    });
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
      await activeLabel().waitFor();
      const newer = await data("update_artboard", {
        projectId,
        commandId: randomUUID(),
        expectedRevision: 4,
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
    await activeLabel().waitFor({ state: "hidden" });
    assert.equal(pinned.isError, undefined);
    assert.equal(pinned.structuredContent.revision, 4);
    assert.equal(pinned.structuredContent.sourceDigest, commit.artboard.sourceDigest);
    const pinnedPng = pinned.content.find(({ type }) => type === "image").data;
    const pinnedPixel = await app.evaluate(({ nativeImage }, encoded) => {
      const pixels = nativeImage.createFromBuffer(Buffer.from(encoded, "base64")).toBitmap();
      const center = (120 * 320 + 160) * 4;
      return [...pixels.subarray(center, center + 4)];
    }, pinnedPng);
    assert.ok(
      pinnedPixel.every((value, index) => Math.abs(value - sample[index]) <= 2),
      String(pinnedPixel),
    );
    statuses.push(
      "An actual capture paused before pixel read; concurrent MCP update committed revision 5 while the image retained revision 4 and its pixels.",
    );

    const nested =
      "<div>".repeat(160) +
      '<span id="deep-marker">Beyond preview depth</span>' +
      "</div>".repeat(160);
    const deep = await data("update_artboard", {
      projectId,
      commandId: randomUUID(),
      expectedRevision: 5,
      arguments: { artboardId, patch: { html: "<h1>Deep preview</h1>" + nested } },
    });
    const deepFrame = desktop.frameLocator('iframe[title="Agent mockup"]');
    await deepFrame.getByRole("heading", { name: "Deep preview" }).waitFor();
    assert.equal(await deepFrame.locator("#deep-marker").count(), 0);
    assert.equal(deep.revision, 6);
    assert.equal(
      (await data("get_artboard", { projectId, artboardId })).html,
      "<h1>Deep preview</h1>" + nested,
    );
    const deepCapture = await client.callTool({
      name: "capture_artboard",
      arguments: scope("capture_artboard", { projectId, artboardId, revision: 6 }),
    });
    assert.equal(deepCapture.isError, undefined, JSON.stringify(deepCapture.content));
    assert.equal(deepCapture.structuredContent.sourceDigest, deep.artboard.sourceDigest);
    await app.evaluate(({ app }) => {
      app.once("browser-window-created", (_event, window) => {
        const debug = window.webContents.debugger;
        const send = debug.sendCommand.bind(debug);
        debug.sendCommand = (command, ...args) =>
          command === "Runtime.evaluate" ? new Promise(() => {}) : send(command, ...args);
      });
    });
    await failure("capture_artboard", { projectId, artboardId, revision: 6 }, "RENDER_TIMEOUT");
    assert.equal(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
    );
    await close();
    await launch();
    await desktop
      .frameLocator('iframe[title="Agent mockup"]')
      .getByRole("heading", { name: "Deep preview" })
      .waitFor();
    assert.equal((await data("get_context")).revision, 6);
    statuses.push(
      "Deep markup stayed bounded in preview, capture and reopen. Canonical source stayed intact and MCP responded.",
    );
    statuses.push("Injected readiness timeout was reported and disposed its capture window.");

    const lost = {
      projectId,
      commandId: randomUUID(),
      expectedRevision: 6,
      arguments: { ...created.arguments, name: "Lost reply mockup", x: 620, y: 360 },
    };
    const aborted = new AbortController();
    const cutoff = new Client({ name: "disposable-lost-reply-client", version: "1.0.0" });
    await cutoff.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { Authorization: "Bearer " + token } },
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          if (typeof init?.body !== "string" || !init.body.includes(lost.commandId))
            return response;
          await response.body?.cancel();
          aborted.abort();
          throw new Error("Synthetic lost MCP reply");
        },
      }),
    );
    await assert.rejects(
      cutoff.callTool(
        { name: "create_artboard", arguments: scope("create_artboard", lost) },
        undefined,
        { signal: aborted.signal },
      ),
    );
    await cutoff.close();
    assert.equal((await data("get_context")).revision, 7);
    await close();
    await launch();
    const commitFromDisk = await data("create_artboard", lost);
    assert.equal(commitFromDisk.revision, 7);
    assert.equal(
      (await data("get_context")).artboards.filter((board) => board.name === "Lost reply mockup")
        .length,
      1,
    );
    await desktop
      .frameLocator('iframe[title="Lost reply mockup"]')
      .getByRole("heading", { name: "Prototype one" })
      .waitFor();
    statuses.push(
      "A second MCP-created board's reply was discarded at the SDK transport. Restart and retry recovered the original board and revision.",
    );

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
          return folder
            ? { canceled: false, filePaths: [folder] }
            : { canceled: true, filePaths: [] };
        };
      }, folder);
      await openSettings();
      const label = action === "New Project" ? "Create project" : "Open project…";
      const control = desktop
        .locator("#settings")
        .getByRole("button", { name: label, exact: true });
      await control.click();
      await desktop.waitForFunction(() =>
        [...document.querySelectorAll("#settings button")].every((button) => !button.disabled),
      );
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
    assert.equal(
      (await desktop.evaluate(() => window.easyProto.getScene())).generation,
      originalScene.generation,
    );
    statuses.push(
      "Cancel and invalid choices retained the current canvas and MCP scope. Open did not initialize an empty folder; New refused an existing project.",
    );

    const fresh = await choose("New Project", another);
    assert.notEqual(fresh.projectId, projectId);
    assert.notEqual(fresh.activationId, original.activationId);
    assert.equal(fresh.revision, 0);
    await desktop.getByText("Fresh project", { exact: true }).waitFor();
    await waitForDesktopRevision(0);
    await desktop
      .frameLocator('iframe[title="Field notes"]')
      .getByRole("heading", { name: "Make room for ideas." })
      .waitFor();
    assert.equal(
      JSON.parse(await readFile(join(another, "project.json"), "utf8")).projectId,
      fresh.projectId,
    );
    assert.equal(await desktop.locator('iframe[title="Agent mockup"]').count(), 0);
    await failure(
      "get_artboard",
      { projectId, activationId: original.activationId, artboardId },
      "PROJECT_SCOPE",
    );

    const branch = await choose("Open Project", copy);
    assert.equal(branch.projectId, projectId);
    assert.notEqual(branch.activationId, original.activationId);
    assert.equal(branch.revision, 7);
    const branchEdit = {
      projectId,
      activationId: branch.activationId,
      expectedRevision: 7,
      commandId: randomUUID(),
      arguments: { artboardId, patch: { html: "<h1>Copy only</h1>" } },
    };
    await data("update_artboard", branchEdit);
    await desktop
      .frameLocator('iframe[title="Agent mockup"]')
      .getByRole("heading", { name: "Copy only" })
      .waitFor();

    const returned = await choose("Open Project", project);
    assert.equal(returned.revision, 7);
    assert.notEqual(returned.activationId, original.activationId);
    await data("update_artboard", {
      ...branchEdit,
      activationId: returned.activationId,
      commandId: randomUUID(),
      arguments: { artboardId, patch: { html: "<h1>Original only</h1>" } },
    });
    await desktop
      .frameLocator('iframe[title="Agent mockup"]')
      .getByRole("heading", { name: "Original only" })
      .waitFor();
    const beforeSwitch = await desktop.evaluate(() => window.easyProto.getScene());
    const previousUrl = beforeSwitch.artboards.find((board) => board.id === artboardId).previewUrl;

    await app.evaluate(({ app }) => {
      app.once("browser-window-created", (_event, window) => {
        const debug = window.webContents.debugger;
        const send = debug.sendCommand.bind(debug);
        debug.sendCommand = (command, ...args) => {
          if (command !== "Page.captureScreenshot") return send(command, ...args);
          globalThis.pickerCaptureStarted = true;
          return new Promise((_resolve, reject) =>
            window.once("closed", () => reject(new Error("Capture window closed"))),
          );
        };
      });
    });
    const oldScope = { projectId, artboardId, activationId: returned.activationId };
    const oldActivity = {
      ...activityScope,
      activationId: oldScope.activationId,
      status: "working",
    };
    await data("set_artboard_activity", oldActivity);
    await activeLabel().waitFor();
    const pending = client.callTool({
      name: "capture_artboard",
      arguments: { ...oldScope, revision: 8 },
    });
    for (
      let attempt = 0;
      attempt < 150 && !(await app.evaluate(() => globalThis.pickerCaptureStarted));
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    assert.equal(await app.evaluate(() => globalThis.pickerCaptureStarted), true);
    const switched = await choose("Open Project", copy);
    assert.equal(switched.projectId, projectId);
    assert.equal(switched.revision, 8);
    assert.notEqual(switched.activationId, returned.activationId);
    assert.equal(switched.assetDigest, branch.assetDigest);
    await desktop
      .frameLocator('iframe[title="Agent mockup"]')
      .getByRole("heading", { name: "Copy only" })
      .waitFor();
    await activeLabel().waitFor({ state: "hidden" });
    const retired = await pending;
    assert.equal(retired.structuredContent.code, "PROJECT_SCOPE");
    assert.equal(
      retired.content.some(({ type }) => type === "image"),
      false,
    );
    assert.equal(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
    );

    for (const [tool, args] of [
      ["get_artboard", oldScope],
      ["get_tokens", { projectId, activationId: oldScope.activationId }],
      [
        "replace_project_tokens",
        {
          projectId,
          activationId: oldScope.activationId,
          expectedRevision: 8,
          commandId: randomUUID(),
          document: "{}",
        },
      ],
      ["capture_artboard", { ...oldScope, revision: 8 }],
      ["set_artboard_activity", oldActivity],
      [
        "create_artboard",
        {
          projectId,
          activationId: oldScope.activationId,
          expectedRevision: 8,
          commandId: randomUUID(),
          arguments: created.arguments,
        },
      ],
      [
        "update_artboard",
        {
          ...branchEdit,
          activationId: oldScope.activationId,
          expectedRevision: 8,
          commandId: randomUUID(),
        },
      ],
    ])
      await failure(tool, args, "PROJECT_SCOPE");
    const oldStatus = await app.evaluate(
      ({ BrowserWindow }, url) =>
        BrowserWindow.getAllWindows()[0]
          .webContents.session.fetch(url)
          .then((response) => response.status),
      previousUrl,
    );
    assert.equal(oldStatus, 404);
    await assert.rejects(
      desktop.evaluate(
        ({ generation, projectId, artboardId, commandId }) =>
          window.easyProto.arrangeArtboard(generation, {
            projectId,
            commandId,
            expectedRevision: 8,
            operation: "update_artboard",
            arguments: { artboardId, patch: { x: 5 } },
          }),
        { generation: beforeSwitch.generation, projectId, artboardId, commandId: randomUUID() },
      ),
      /project selection changed/i,
    );
    assert.equal(
      (await data("get_artboard", { ...oldScope, activationId: switched.activationId })).html,
      "<h1>Copy only</h1>",
    );
    assert.equal(
      (await data("update_artboard", { ...branchEdit, activationId: switched.activationId }))
        .revision,
      8,
    );
    assert.equal((await data("get_context")).revision, 8);
    const freshCapture = await client.callTool({
      name: "capture_artboard",
      arguments: { ...oldScope, activationId: switched.activationId, revision: 8 },
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
          await new Promise((resolve) => {
            globalThis.releasePickerCommit = resolve;
          });
          fs.rename = rename;
          syncBuiltinESMExports();
        }
        return rename(from, to);
      };
      syncBuiltinESMExports();
    });
    const pendingEdit = {
      ...branchEdit,
      activationId: switched.activationId,
      expectedRevision: 8,
      commandId: randomUUID(),
      arguments: { artboardId, patch: { html: "<h1>Saved before reopen</h1>" } },
    };
    const pendingSave = client.callTool({ name: "update_artboard", arguments: pendingEdit });
    let reopening;
    try {
      for (
        let attempt = 0;
        attempt < 150 && !(await app.evaluate(() => Boolean(globalThis.releasePickerCommit)));
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      assert.equal(await app.evaluate(() => Boolean(globalThis.releasePickerCommit)), true);
      reopening = choose("Open Project", copy);
      await desktop.waitForFunction(() => document.querySelector("#settings button").disabled);
      assert.equal((await data("get_context")).activationId, switched.activationId);
      await failure(
        "update_artboard",
        { ...branchEdit, activationId: switched.activationId },
        "PROJECT_SWITCHING",
      );
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
    await desktop
      .frameLocator('iframe[title="Agent mockup"]')
      .getByRole("heading", { name: "Saved before reopen" })
      .waitFor();
    assert.equal(
      (await data("update_artboard", { ...pendingEdit, activationId: reopenedCopy.activationId }))
        .revision,
      9,
    );
    statuses.push(
      "A same-folder reopen waited for an admitted MCP save paused at publication, then loaded revision 9 and replayed that command under fresh scope.",
    );

    statuses.push(
      "New started revision zero and Open restored saved work. The same connected SDK client discovered fresh authority for a divergent same-ID copy.",
    );
    statuses.push(
      "The retired activation could neither read, capture, create nor update. A pending capture returned no image; its old live URL returned 404 and stale renderer moves were rejected. Fresh scope read, captured and replayed a prior commit.",
    );
    if (evidence) {
      await desktop.screenshot({
        path: join(evidence, "project-picker-canvas.png"),
        animations: "disabled",
      });
    }

    const currentScene = await desktop.evaluate(() => window.easyProto.getScene());
    const layoutAttempt = {
      projectId,
      commandId: randomUUID(),
      expectedRevision: 9,
      operation: "update_artboard",
      arguments: { artboardId, patch: { width: 380 } },
    };
    await assert.rejects(
      desktop.evaluate(
        ({ generation, command }) => window.easyProto.arrangeArtboard(generation, command),
        {
          generation: currentScene.generation,
          command: {
            ...layoutAttempt,
            arguments: { artboardId, patch: { width: 380, html: "<p>Disallowed</p>" } },
          },
        },
      ),
      /only change artboard name, position or size/,
    );
    const unauthorized = await app.evaluate(
      async ({ BrowserWindow }, { generation, command, clipboardId }) => {
        const trusted = BrowserWindow.getAllWindows().find((window) => window.isVisible());
        const { join } = process.getBuiltinModule("node:path");
        const testWindow = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: join(process.cwd(), "dist", "preload.cjs"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            session: trusted.webContents.session,
          },
        });
        const diagnostics = [];
        testWindow.webContents.on("console-message", (details) =>
          diagnostics.push(details.message),
        );
        try {
          await testWindow.loadURL("easy-proto://ui/index.html");
          return await testWindow.webContents.executeJavaScript(
            `Promise.all([
              () => window.easyProto.arrangeArtboard(${generation}, ${JSON.stringify(command)}),
              () => window.easyProto.copyArtboards(${generation}, ${JSON.stringify([command.arguments.artboardId])}, ${JSON.stringify(clipboardId)})
            ].map(action => Promise.resolve().then(action).then(() => "", error => error.message)))`,
          );
        } catch (error) {
          throw new Error(error.message + " " + diagnostics.join(" | "));
        } finally {
          testWindow.destroy();
        }
      },
      { generation: currentScene.generation, command: layoutAttempt, clipboardId: randomUUID() },
    );
    assert.equal(unauthorized.length, 2);
    for (const message of unauthorized) assert.match(message, /only the application window/i);
    statuses.push("Secondary preload window was denied both arrange and copy.");
    assert.equal((await data("get_context")).revision, 9);
    const chromeFont = await desktop.evaluate(() => {
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (!(rule instanceof CSSFontFaceRule) || rule.style.fontFamily !== "Inter") continue;
          const path = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.src)?.[1];
          if (path) return new URL(path, sheet.href ?? location.href).href;
        }
      }
      throw new Error("Bundled Inter source not found.");
    });

    const responsive = {
      projectId,
      activationId: reopenedCopy.activationId,
      commandId: randomUUID(),
      expectedRevision: 9,
      arguments: {
        artboardId,
        patch: {
          width: 320,
          height: 240,
          html: '<main><h1>Responsive fixture</h1><p class="compact">Compact layout</p><p class="wide">Wide layout</p></main>',
          css: `@font-face{font-family:ChromeOnly;src:url("${chromeFont}")}body{margin:0;background:white;color:#171717;font:16px ChromeOnly,system-ui}main{padding:24px}.wide{display:none}@media(min-width:400px){.wide{display:block}.compact{display:none}}`,
        },
      },
    };
    const responsiveCommit = await data("update_artboard", responsive);
    const responsiveNode = desktop.locator(".react-flow__node").filter({ hasText: "Agent mockup" });
    await fitCanvas(desktop);
    const responsiveFrame = desktop.frameLocator('iframe[title="Agent mockup"]');
    await responsiveFrame.getByText("Compact layout").waitFor();
    const inside = desktop.frames().find((frame) => frame.url().includes(artboardId));
    const frameUrl = inside.url();
    const iframe = desktop.locator('iframe[title="Agent mockup"]');
    assert.deepEqual(await inside.evaluate(() => [innerWidth, innerHeight]), [320, 240]);
    assert.equal(
      await inside.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].find((font) => font.family === "ChromeOnly")?.status;
      }),
      "error",
    );
    const beforeZoomBox = await iframe.boundingBox();
    const beforeResizeZoom = await canvasTransform();
    await pinchCanvas(desktop, -10);
    await desktop.waitForFunction(
      (before) => document.querySelector(".react-flow__viewport").getAttribute("style") !== before,
      beforeResizeZoom,
    );
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
    const afterZoomBox = await iframe.boundingBox();
    assert.ok(afterZoomBox.width > beforeZoomBox.width);
    assert.deepEqual(await inside.evaluate(() => [innerWidth, innerHeight]), [320, 240]);
    assert.equal(await responsiveFrame.getByText("Compact layout").isVisible(), true);
    assert.equal((await data("get_context")).revision, 10);
    const dimensions = responsiveNode.getByRole("button", { name: /Device size/ });
    const deviceMenu = responsiveNode.getByRole("group", { name: "Device sizes" });
    const device = (name) => deviceMenu.getByRole("button", { name });
    assert.equal(
      await desktop
        .locator(".react-flow__controls, .react-flow__attribution, .resize-handle")
        .count(),
      0,
    );
    await dimensions.press("Enter");
    await deviceMenu.waitFor();
    await desktop.waitForFunction(() => document.activeElement?.textContent.includes("iPhone SE"));
    await desktop.keyboard.press("ArrowDown");
    const iphone = device(/iPhone 16 Pro 402/);
    assert.equal(await iphone.evaluate((element) => element === document.activeElement), true);
    await desktop.keyboard.press("Enter");
    await deviceMenu.waitFor({ state: "hidden" });
    await waitForDesktopRevision(11);
    await responsiveFrame.getByText("Wide layout").waitFor();
    const resized = await data("get_artboard", {
      projectId,
      artboardId,
      activationId: reopenedCopy.activationId,
    });
    assert.deepEqual([resized.artboard.width, resized.artboard.height], [402, 874]);
    assert.deepEqual(
      [resized.artboard.x, resized.artboard.y],
      [responsiveCommit.artboard.x, responsiveCommit.artboard.y],
    );
    assert.equal(resized.artboard.sourceRevision, responsiveCommit.artboard.sourceRevision);
    assert.equal(inside.url(), frameUrl);
    assert.equal(
      desktop.frames().find((frame) => frame.url().includes(artboardId)),
      inside,
    );
    assert.deepEqual(await inside.evaluate(() => [innerWidth, innerHeight]), [402, 874]);
    const menuFocus = () => dimensions.evaluate((element) => element === document.activeElement);
    assert.equal(await menuFocus(), true);

    await dimensions.click();
    await deviceMenu.waitFor();
    assert.equal(await iphone.getAttribute("aria-pressed"), "true");
    await desktop.keyboard.press("Escape");
    await deviceMenu.waitFor({ state: "hidden" });
    await waitForDesktopRevision(11);
    await dimensions.click();
    await iphone.click();
    await deviceMenu.waitFor({ state: "hidden" });
    await waitForDesktopRevision(11);

    await dimensions.click();
    await deviceMenu.waitFor();
    await data("update_artboard", {
      projectId,
      activationId: reopenedCopy.activationId,
      commandId: randomUUID(),
      expectedRevision: 11,
      arguments: { artboardId, patch: { width: 380 } },
    });
    await dimensions.getAttribute("aria-label");
    await device(/iPad mini 768/).click();
    const resizeError = desktop.getByRole("alert");
    assert.match(await resizeError.innerText({ timeout: 5000 }), /try the change again/i);
    await resizeError.getByRole("button", { name: "Dismiss" }).click();
    await responsiveFrame.getByText("Compact layout").waitFor();
    assert.deepEqual(await inside.evaluate(() => [innerWidth, innerHeight]), [380, 874]);
    await waitForDesktopRevision(12);

    await dimensions.click();
    await device(/iPad mini 768/).click();
    await waitForDesktopRevision(13);
    await responsiveFrame.getByText("Wide layout").waitFor();
    assert.deepEqual(await inside.evaluate(() => [innerWidth, innerHeight]), [768, 1024]);
    statuses.push({
      devicePresets: {
        initialViewport: [320, 240],
        displayWidthBeforeZoom: beforeZoomBox.width,
        displayWidthAfterZoom: afterZoomBox.width,
        iphone: [402, 874],
        ipad: [768, 1024],
        mediaQuery: "compact after zoom, wide after applying a preset",
        staleSelectionRejected: true,
        escapeAndSameSizePreservedRevision: true,
      },
    });
    const sizeCapture = await client.callTool({
      name: "capture_artboard",
      arguments: { projectId, artboardId, activationId: reopenedCopy.activationId, revision: 13 },
    });
    assert.equal(sizeCapture.isError, undefined, JSON.stringify(sizeCapture.content[0]));
    assert.deepEqual(
      [sizeCapture.structuredContent.pixelWidth, sizeCapture.structuredContent.pixelHeight],
      [768, 1024],
    );
    const afterResizeReopen = await choose("Open Project", copy);
    assert.equal(afterResizeReopen.revision, 13);
    await responsiveFrame.getByText("Wide layout").waitFor();
    const reopenedFrame = desktop.frames().find((frame) => frame.url().includes(artboardId));
    assert.deepEqual(await reopenedFrame.evaluate(() => [innerWidth, innerHeight]), [768, 1024]);
    assert.ok(
      sizeCapture.structuredContent.unresolved.some((issue) =>
        issue.includes("Font could not load: ChromeOnly"),
      ),
    );
    statuses.push("Capture and folder reopen matched the committed device preset.");
    statuses.push(
      "Arrange IPC refused a different sender and a mixed HTML/geometry patch; the bundled chrome font failed to load in both live and captured previews.",
    );

    const themeInfo = () =>
      desktop.evaluate(async () => {
        await document.fonts.ready;
        const inter = [...document.fonts].find((font) => font.family === "Inter");
        return {
          scheme: getComputedStyle(document.documentElement).colorScheme,
          background: getComputedStyle(document.querySelector("header")).backgroundColor,
          canvas: getComputedStyle(document.querySelector(".react-flow__background"))
            .backgroundColor,
          headerHeight: getComputedStyle(document.querySelector("header")).height,
          interfaceSize: getComputedStyle(document.documentElement).fontSize,
          labelSize: getComputedStyle(document.querySelector(".artboard-label")).fontSize,
          inter: inter?.status,
        };
      });
    await setAppearance("light");
    await desktop.waitForFunction(() => document.documentElement.dataset.theme === "light");
    const light = await themeInfo();
    assert.deepEqual(light, {
      scheme: "light",
      background: "rgb(255, 255, 255)",
      canvas: "rgb(245, 245, 245)",
      headerHeight: "58px",
      interfaceSize: "13px",
      labelSize: "12px",
      inter: "loaded",
    });
    const appArtboardColor = await reopenedFrame.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    if (evidence) {
      await openSettings();
      await desktop.screenshot({
        path: join(evidence, "settings-light.png"),
        animations: "disabled",
      });
      await desktop.keyboard.press("Escape");
    }
    await setAppearance("dark");
    await desktop.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    const dark = await themeInfo();
    assert.deepEqual(dark, {
      scheme: "dark",
      background: "rgb(44, 44, 44)",
      canvas: "rgb(30, 30, 30)",
      headerHeight: "58px",
      interfaceSize: "13px",
      labelSize: "12px",
      inter: "loaded",
    });
    assert.equal(
      await reopenedFrame.evaluate(() => getComputedStyle(document.body).backgroundColor),
      appArtboardColor,
    );
    assert.equal(
      desktop.frames().find((frame) => frame.url().includes(artboardId)),
      reopenedFrame,
    );
    if (evidence) {
      await openSettings();
      await desktop.screenshot({
        path: join(evidence, "settings-dark.png"),
        animations: "disabled",
      });
      await desktop.keyboard.press("Escape");
    }
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.isVisible())
        .setSize(660, 480),
    );
    await desktop.waitForFunction(() => innerWidth === 660);
    await desktop.waitForFunction(
      () => document.querySelector(".settings-button").getBoundingClientRect().right <= innerWidth,
      undefined,
      { timeout: 5000 },
    );
    await fitCanvas(desktop);
    await dimensions.click();
    await deviceMenu.waitFor();
    const menuBox = await deviceMenu.boundingBox();
    assert.ok(menuBox.x >= 0 && menuBox.y >= 0);
    assert.ok(menuBox.x + menuBox.width <= 660 && menuBox.y + menuBox.height <= 480);
    if (evidence)
      await desktop.screenshot({
        path: join(evidence, "device-presets-dark-minimum.png"),
        animations: "disabled",
      });
    await desktop.keyboard.press("Escape");
    await deviceMenu.waitFor({ state: "hidden" });
    await setAppearance("light");
    await dimensions.click();
    await deviceMenu.waitFor();
    if (evidence)
      await desktop.screenshot({
        path: join(evidence, "device-presets-light-minimum.png"),
        animations: "disabled",
      });
    await desktop.keyboard.press("Escape");
    await deviceMenu.waitFor({ state: "hidden" });
    await setAppearance("system");
    await desktop.waitForFunction(
      () =>
        document.documentElement.dataset.theme ===
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    );
    const system = await themeInfo();
    const opposite = system.scheme === "dark" ? "light" : "dark";
    await desktop.emulateMedia({ colorScheme: opposite });
    await desktop.waitForFunction(
      (scheme) => document.documentElement.dataset.theme === scheme,
      opposite,
    );
    await desktop.emulateMedia({ colorScheme: null });
    statuses.push({
      appearance: {
        light,
        dark,
        system,
        systemPreferenceChange: opposite,
        authoredArtboardBackground: appArtboardColor,
      },
    });
    await data("replace_project_tokens", {
      projectId,
      activationId: afterResizeReopen.activationId,
      commandId: randomUUID(),
      expectedRevision: afterResizeReopen.revision,
      document: JSON.stringify({
        desktop: {
          light: {
            background: { $type: "color", $value: { colorSpace: "srgb", components: [1, 0, 0] } },
          },
          dark: {
            background: { $type: "color", $value: { colorSpace: "srgb", components: [0, 1, 0] } },
          },
          layout: { header: { $type: "dimension", $value: { value: 1, unit: "px" } } },
        },
      }),
    });
    await waitForDesktopRevision(afterResizeReopen.revision + 1);
    await setAppearance("light");
    assert.deepEqual(await themeInfo(), light);
    await setAppearance("dark");
    assert.deepEqual(await themeInfo(), dark);
    statuses.push("Project token names that match desktop tokens leave desktop chrome unchanged.");
  },
);

test(
  "Home reopens and the desktop saves artboards, pages and project-wide tokens",
  { timeout: 85_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "easy-proto-home-"));
    const project = join(root, "Project folder");
    const profile = join(root, "profile");
    const token = randomBytes(32).toString("base64url");
    await mkdir(project);
    let app, desktop, client, port;
    t.after(async () => {
      await client?.close();
      await app?.close();
      await rm(root, { recursive: true, force: true });
    });
    async function launch() {
      const reservation = createServer();
      await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
      port = reservation.address().port;
      await new Promise((resolve) => reservation.close(resolve));
      app = await electron.launch({
        args: [process.cwd()],
        env: {
          ...process.env,
          EASY_PROTO_PROFILE: profile,
          EASY_PROTO_TOKEN: token,
          EASY_PROTO_PORT: String(port),
        },
      });
      desktop = await app.firstWindow();
      await desktop.getByRole("heading", { name: "Projects" }).waitFor();
    }
    async function connect() {
      client = new Client({ name: "home-integration", version: "1.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: { Authorization: "Bearer " + token } },
        }),
      );
    }
    async function call(name, args = {}) {
      return (await client.callTool({ name, arguments: args })).structuredContent;
    }
    async function menu() {
      await desktop.getByRole("button", { name: "Settings", exact: true }).click();
      await desktop.locator("#settings").waitFor();
    }
    async function returnHome() {
      await menu();
      await desktop.getByRole("button", { name: "Home", exact: true }).click();
      await desktop.getByRole("heading", { name: "Projects" }).waitFor();
    }
    const snapshot = () => desktop.evaluate(() => window.easyProto.getScene());
    const edit = (kind) => desktop.getByRole("textbox", { name: kind + " name", exact: true });
    const title = (kind, name) =>
      desktop.getByRole("button", { name: "Rename " + kind + " " + name, exact: true });
    const row = (name) => desktop.locator(".home").getByRole("button", { name, exact: true });

    await launch();
    await connect();
    await desktop.getByText("No projects yet", { exact: true }).waitFor();
    assert.deepEqual((await snapshot()).projects, []);
    assert.equal(await desktop.getByRole("heading", { name: "Agents" }).count(), 0);
    assert.deepEqual(
      await desktop.evaluate(() =>
        Object.keys(window.easyProto).filter((key) => /agent|chat/i.test(key)),
      ),
      [],
    );
    assert.equal((await call("get_context")).code, "NO_PROJECT");
    assert.equal(await desktop.getByRole("group", { name: "Appearance" }).count(), 0);
    if (evidence) await desktop.screenshot({ path: join(evidence, "home-empty.png") });
    await app.evaluate(({ dialog }, project) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
    }, project);
    await desktop.getByRole("button", { name: "Create project", exact: true }).click();
    const projectTitle = title("project", "Project folder");
    await projectTitle.waitFor();
    assert.equal(await desktop.getByRole("button", { name: "Chat", exact: true }).count(), 0);
    assert.equal(await desktop.getByText("Saved · Revision", { exact: false }).count(), 0);
    const context = await call("get_context");
    const {
      activationId,
      projectId,
      artboards: [{ id: artboardId }],
    } = context;
    const auth = { projectId, activationId, artboardId };
    const initial = await snapshot();
    const previewUrl = initial.artboards[0].previewUrl;
    await projectTitle.dblclick();
    await edit("Project").fill("Canceled name");
    await edit("Project").press("Escape");
    await projectTitle.waitFor();
    assert.equal(await projectTitle.evaluate((button) => document.activeElement === button), true);
    await projectTitle.press("Enter");
    await edit("Project").fill("  Studio project  ");
    await edit("Project").press("Enter");
    await title("project", "Studio project").waitFor();
    assert.equal((await snapshot()).revision, initial.revision);
    assert.equal((await call("get_context")).name, "Studio project");
    assert.deepEqual(
      JSON.parse(await readFile(join(project, ".easy-proto", "name.json"), "utf8")),
      { name: "Studio project" },
    );

    const artboard = title("artboard", "Field notes");
    const node = desktop.locator(".react-flow__node");
    const dimensions = node.locator(".artboard-dimensions");
    const frame = desktop.frames().find((item) => item.url() === previewUrl);
    const frameSize = () => frame.evaluate(() => [innerWidth, innerHeight]);
    const transform = () => desktop.locator(".react-flow__viewport").getAttribute("style");
    await fitCanvas(desktop);
    await desktop.waitForFunction(() => !!document.querySelector(".artboard-meta"));
    const before = await transform();
    await artboard.dblclick();
    assert.equal(await transform(), before);
    await edit("Artboard").fill("Canceled board");
    await edit("Artboard").press("Escape");
    await artboard.waitFor();
    await artboard.dblclick();
    await edit("Artboard").fill("Sketches");
    await edit("Artboard").press("ArrowLeft");
    await edit("Artboard").press("Enter");
    const renamed = title("artboard", "Sketches");
    await renamed.waitFor();
    assert.equal((await snapshot()).revision, initial.revision + 1);
    assert.equal((await snapshot()).artboards[0].x, initial.artboards[0].x);
    assert.equal((await snapshot()).artboards[0].previewUrl, previewUrl);

    const activity = { ...auth, activityId: randomUUID() };
    assert.equal(
      (await call("set_artboard_activity", { ...activity, status: "working" })).working,
      true,
    );
    const activityLabel = node.getByRole("status").filter({ hasText: "Agent working" });
    await activityLabel.waitFor();
    const heights = () =>
      Promise.all(
        [renamed, dimensions, activityLabel].map((locator) =>
          locator.evaluate((element) => element.getBoundingClientRect().height),
        ),
      );
    const startingHeights = await heights();
    const startingWidth = (await node.boundingBox()).width;
    const zoom = () =>
      node
        .locator(".artboard-meta")
        .evaluate((element) => 1 / Number(element.style.getPropertyValue("--inverse-zoom")));
    async function zoomTo(deltaY, reached) {
      for (let i = 0; i < 22; i++) {
        const previous = await zoom();
        if (reached(previous)) return;
        await pinchCanvas(desktop, deltaY);
        await desktop.waitForFunction(
          (previous) =>
            1 /
              Number(
                document.querySelector(".artboard-meta").style.getPropertyValue("--inverse-zoom"),
              ) !==
            previous,
          previous,
          { timeout: 2000 },
        );
      }
      assert.fail("Did not reach target zoom");
    }
    await zoomTo(12.5, (value) => value <= 0.1);
    assert.ok((await node.boundingBox()).width < startingWidth / 4);
    assert.ok(
      (await heights()).every(
        (height, index) => height >= 16 && Math.abs(height - startingHeights[index]) < 0.5,
      ),
    );
    assert.deepEqual(await frameSize(), [540, 360]);
    await zoomTo(-12.5, (value) => value >= 2.95);
    assert.ok(
      (await heights()).every((height, index) => Math.abs(height - startingHeights[index]) < 0.5),
    );
    assert.deepEqual(await frameSize(), [540, 360]);
    assert.equal(
      desktop.frames().find((item) => item.url() === previewUrl),
      frame,
    );
    await fitCanvas(desktop);
    if (evidence) {
      await menu();
      await desktop.screenshot({ path: join(evidence, "workspace-settings.png") });
      await desktop.keyboard.press("Escape");
      await desktop.locator("#settings").waitFor({ state: "hidden" });
    }

    await returnHome();
    assert.equal((await call("get_context")).code, "NO_PROJECT");
    assert.equal((await call("get_artboard", auth)).code, "PROJECT_SCOPE");
    assert.equal(
      await app.evaluate(async ({ BrowserWindow }, url) => {
        const session = BrowserWindow.getAllWindows().find((window) => window.isVisible())
          .webContents.session;
        return (await session.fetch(url)).status;
      }, previewUrl),
      404,
    );
    assert.deepEqual(Object.keys((await snapshot()).projects[0]).sort(), ["id", "name"]);
    if (evidence) await desktop.screenshot({ path: join(evidence, "home-projects.png") });
    await row("Studio project").click();
    await renamed.waitFor();
    assert.notEqual((await call("get_context")).activationId, activationId);

    await client.close();
    client = undefined;
    await app.close();
    app = undefined;
    await launch();
    await connect();
    await row("Studio project").waitFor();
    const moved = join(root, "Moved folder");
    await rename(project, moved);
    await row("Studio project").click();
    const alert = desktop.getByRole("alert");
    assert.match(await alert.innerText(), /If it moved/);
    await alert.getByRole("button", { name: "Dismiss" }).click();
    await symlink(moved, project, "dir");
    try {
      await row("Studio project").click();
      assert.match(await alert.innerText(), /If it moved/);
      assert.equal((await call("get_context")).code, "NO_PROJECT");
      await alert.getByRole("button", { name: "Dismiss" }).click();
    } finally {
      await rm(project);
    }
    await app.evaluate(({ dialog }, moved) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [moved] });
    }, moved);
    await menu();
    await desktop.getByRole("button", { name: "Open project…" }).click();
    await title("project", "Studio project").waitFor();
    await title("artboard", "Sketches").waitFor();
    await returnHome();
    assert.equal(await row("Studio project").count(), 1);

    await row("Studio project").click();
    const sketchTitle = title("artboard", "Sketches");
    await sketchTitle.waitFor();
    const duplicateContext = await call("get_context");
    const duplicateScope = { projectId, activationId: duplicateContext.activationId };
    const original = await call("get_artboard", { ...duplicateScope, artboardId });
    await desktop.keyboard.press("Meta+d");
    assert.equal((await snapshot()).artboards.length, 1);
    await desktop.locator(".react-flow__node .artboard").click({ position: { x: 40, y: 40 } });
    await desktop.locator(".react-flow__node.selected").waitFor();
    await sketchTitle.dblclick();
    await edit("Artboard").press("Meta+d");
    await edit("Artboard").press("Escape");
    assert.equal((await snapshot()).artboards.length, 1);
    await desktop.evaluate(() => {
      const canv = document.querySelector(".canvas");
      const inspect = () => {
        const preview = canv.querySelector('.artboard-preview:has(iframe[title="Sketches copy"])');
        if (!preview || window.easyProtoPreviewEntry) return;
        window.easyProtoPreviewEntry = {
          loaded: preview.dataset.loaded,
          opacity: getComputedStyle(preview).opacity,
          layout: [preview.offsetWidth, preview.offsetHeight],
        };
        observer.disconnect();
      };
      const observer = new MutationObserver(inspect);
      observer.observe(canv, { childList: true, subtree: true });
    });
    await desktop.keyboard.press("Meta+d");
    const copiedTitle = title("artboard", "Sketches copy");
    await copiedTitle.waitFor();
    const duplicate = (await snapshot()).artboards.find(({ id }) => id !== artboardId);
    assert.ok(duplicate.id);
    const copyNode = desktop.locator(`.react-flow__node[data-id="${duplicate.id}"]`);
    await copyNode.and(desktop.locator(".react-flow__node.selected")).waitFor();
    assert.deepEqual(await desktop.evaluate(() => window.easyProtoPreviewEntry), {
      loaded: "false",
      opacity: "0",
      layout: [540, 360],
    });
    const copyPreview = copyNode.locator('.artboard-preview[data-loaded="true"]');
    await copyPreview.waitFor();
    assert.equal(
      await copyPreview.evaluate((element) => getComputedStyle(element).transitionDuration),
      "0.18s",
    );
    await desktop.waitForFunction(
      (id) =>
        getComputedStyle(document.querySelector(`[data-id="${id}"] .artboard-preview`)).opacity ===
        "1",
      duplicate.id,
    );
    assert.equal(await desktop.locator(".react-flow__node.selected").count(), 1);
    assert.equal(await copyNode.evaluate((element) => element === document.activeElement), true);
    assert.equal((await snapshot()).revision, original.revision + 1);
    assert.deepEqual(
      [duplicate.x, duplicate.y, duplicate.width, duplicate.height],
      [
        original.artboard.x + 40,
        original.artboard.y + 40,
        original.artboard.width,
        original.artboard.height,
      ],
    );
    const duplicateBoard = await call("get_artboard", {
      ...duplicateScope,
      artboardId: duplicate.id,
    });
    assert.equal(duplicateBoard.html, original.html);
    assert.equal(duplicateBoard.css, original.css);
    assert.notEqual(duplicateBoard.artboard.htmlRef, original.artboard.htmlRef);
    assert.notEqual(duplicateBoard.artboard.cssRef, original.artboard.cssRef);
    assert.equal(duplicate.agentWorking, false);
    if (evidence) await desktop.screenshot({ path: join(evidence, "artboard-duplicate.png") });

    const updated = await call("update_artboard", {
      ...duplicateScope,
      expectedRevision: duplicateBoard.revision,
      commandId: randomUUID(),
      arguments: {
        artboardId: duplicate.id,
        patch: { html: "<h1>Independent copy</h1>", css: "h1{color:teal}" },
      },
    });
    assert.equal(updated.status, "committed");
    await desktop
      .frameLocator('iframe[title="Sketches copy"]')
      .getByRole("heading", { name: "Independent copy" })
      .waitFor();
    await desktop
      .frameLocator('iframe[title="Sketches"]')
      .getByRole("heading", { name: "Make room for ideas." })
      .waitFor();
    const originalAfter = await call("get_artboard", { ...duplicateScope, artboardId });
    assert.equal(originalAfter.html, original.html);
    assert.equal(originalAfter.css, original.css);
    await returnHome();
    await row("Studio project").click();
    await copiedTitle.waitFor();
    await desktop
      .frameLocator('iframe[title="Sketches copy"]')
      .getByRole("heading", { name: "Independent copy" })
      .waitFor();
    const reopened = (await snapshot()).artboards.find(({ id }) => id === duplicate.id);
    assert.deepEqual([reopened.x, reopened.y], [duplicate.x, duplicate.y]);
    const sourceNode = desktop.locator(`.react-flow__node[data-id="${artboardId}"]`);
    await sourceNode.locator(".artboard").click({ position: { x: 15, y: 35 } });
    await sourceNode.and(desktop.locator(".react-flow__node.selected")).waitFor();
    const copied = await sourceNode.evaluate((element) => {
      const data = new DataTransfer();
      element.dispatchEvent(
        new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }),
      );
      return Object.fromEntries(data.types.map((type) => [type, data.getData(type)]));
    });
    assert.deepEqual(Object.keys(copied), ["application/x-easy-proto-artboard"]);
    assert.match(Object.values(copied)[0], /^[0-9a-f-]{36}$/);
    const beforePaste = await snapshot();
    await desktop.evaluate((copied) => {
      const data = new DataTransfer();
      for (const [type, value] of Object.entries(copied)) data.setData(type, value);
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, copied);
    await desktop.waitForFunction(
      () => document.querySelectorAll(".react-flow__node").length === 3,
    );
    const pasted = (await snapshot()).artboards.find(
      (item) => !beforePaste.artboards.some(({ id }) => id === item.id),
    );
    const pastedNode = desktop.locator(`.react-flow__node[data-id="${pasted.id}"]`);
    await pastedNode.and(desktop.locator(".react-flow__node.selected")).waitFor();
    assert.deepEqual([pasted.x, pasted.y], [original.artboard.x + 80, original.artboard.y + 80]);
    await pastedNode.getByRole("button", { name: /Rename artboard/ }).dblclick();
    const input = edit("Artboard");
    await input.press("End");
    await desktop.keyboard.insertText(" draft");
    await input.press("Meta+z");
    assert.equal(await input.inputValue(), pasted.name);
    assert.equal((await snapshot()).artboards.length, 3);
    await input.press("Escape");
    await desktop.keyboard.press("Meta+z");
    await pastedNode.waitFor({ state: "detached" });
    assert.equal((await snapshot()).canRedo, true);
    await desktop.keyboard.press("Meta+Shift+z");
    await pastedNode.waitFor();
    await desktop.keyboard.press("Meta+z");
    await pastedNode.waitFor({ state: "detached" });
    await returnHome();
    await row("Studio project").click();
    await copiedTitle.waitFor();
    assert.deepEqual(
      (await snapshot()).artboards.map(({ id }) => id),
      beforePaste.artboards.map(({ id }) => id),
    );
    assert.equal((await snapshot()).canRedo, false);
    await desktop.evaluate((copied) => {
      const data = new DataTransfer();
      for (const [type, value] of Object.entries(copied)) data.setData(type, value);
      const handled = !document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
      if (handled) throw new Error("Reopening should expire the prior activation's clipboard.");
    }, copied);

    const deletionStart = await snapshot();
    await desktop.keyboard.press("Delete");
    assert.equal((await snapshot()).revision, deletionStart.revision);
    await sourceNode.locator(".artboard").click({ position: { x: 15, y: 35 } });
    await sourceNode.and(desktop.locator(".react-flow__node.selected")).waitFor();
    await sketchTitle.dblclick();
    await edit("Artboard").press("ArrowRight");
    await edit("Artboard").press("Backspace");
    assert.equal(await edit("Artboard").inputValue(), "Sketche");
    await edit("Artboard").press("Escape");
    assert.equal((await snapshot()).revision, deletionStart.revision);

    const deletionContext = await call("get_context");
    const activeScope = { projectId, activationId: deletionContext.activationId, artboardId };
    const originalUrl = deletionStart.artboards.find(({ id }) => id === artboardId).previewUrl;
    assert.equal(
      (
        await call("set_artboard_activity", {
          ...activeScope,
          activityId: randomUUID(),
          status: "working",
        })
      ).working,
      true,
    );
    await desktop.keyboard.press("Backspace");
    await sourceNode.waitFor({ state: "detached" });
    assert.equal((await snapshot()).revision, deletionStart.revision + 1);
    assert.equal((await call("get_artboard", activeScope)).code, "ARTBOARD_NOT_FOUND");
    assert.equal(
      await app.evaluate(async ({ BrowserWindow }, url) => {
        const window = BrowserWindow.getAllWindows().find((item) => item.isVisible());
        return (await window.webContents.session.fetch(url)).status;
      }, originalUrl),
      404,
    );
    if (evidence) await desktop.screenshot({ path: join(evidence, "artboard-deleted.png") });
    await desktop.emulateMedia({ reducedMotion: "reduce" });
    await desktop.keyboard.press("Meta+z");
    await sourceNode.and(desktop.locator(".react-flow__node.selected")).waitFor();
    await desktop
      .frameLocator('iframe[title="Sketches"]')
      .getByRole("heading", { name: "Make room for ideas." })
      .waitFor();
    const restoredPreview = sourceNode.locator('.artboard-preview[data-loaded="true"]');
    await restoredPreview.waitFor();
    assert.deepEqual(
      await restoredPreview.evaluate((element) => {
        const { transitionDuration, opacity } = getComputedStyle(element);
        return [transitionDuration, opacity];
      }),
      ["0s", "1"],
    );
    const restored = (await snapshot()).artboards.find(({ id }) => id === artboardId);
    assert.equal(restored.agentWorking, false);
    assert.notEqual(restored.previewUrl, originalUrl);
    const restoredSource = await call("get_artboard", activeScope);
    assert.equal(restoredSource.html, original.html);
    assert.equal(restoredSource.css, original.css);
    if (evidence) await desktop.screenshot({ path: join(evidence, "artboard-restored.png") });

    await desktop.keyboard.press("Meta+Shift+z");
    await sourceNode.waitFor({ state: "detached" });
    await desktop.keyboard.press("Meta+z");
    await sourceNode.and(desktop.locator(".react-flow__node.selected")).waitFor();
    await desktop.keyboard.press("Delete");
    await sourceNode.waitFor({ state: "detached" });
    await returnHome();
    await row("Studio project").click();
    await copiedTitle.waitFor();
    assert.deepEqual(
      (await snapshot()).artboards.map(({ id }) => id),
      [duplicate.id],
    );
    assert.equal((await snapshot()).canUndo, false);

    const groupScope = { projectId, activationId: (await call("get_context")).activationId };
    const positions = (await snapshot()).artboards[0];
    const groupBoards = [];
    for (const [index, name] of ["Group one", "Group two"].entries()) {
      const current = await snapshot();
      const commit = await call("create_artboard", {
        ...groupScope,
        commandId: randomUUID(),
        expectedRevision: current.revision,
        arguments: {
          name,
          width: 160,
          height: 150,
          x: positions.x + positions.width + 120 + index * 250,
          y: positions.y + 100,
          html: `<main>${name}</main>`,
          css: "body{background:#efefef;font:20px system-ui}",
        },
      });
      groupBoards.push(commit.artboard);
    }
    const boardNode = (id) => desktop.locator(`.react-flow__node[data-id="${id}"]`);
    const [left, right] = groupBoards.map(({ id }) => boardNode(id));
    await right.waitFor();
    await fitCanvas(desktop);
    const selectedNodes = desktop.locator(".react-flow__node.selected");
    const selectedIds = () =>
      selectedNodes.evaluateAll((nodes) => nodes.map((item) => item.dataset.id));
    const groupIds = groupBoards.map(({ id }) => id);
    const selectionCount = desktop.getByText("2 artboards selected", { exact: true });
    const visualOutline = desktop.locator(".artboard-group-outline");
    const spot = { x: 35, y: 35 };
    const beforeKeyboard = await snapshot();
    await left.focus();
    await desktop.keyboard.press("Enter");
    assert.deepEqual(await selectedIds(), [groupIds[0]]);
    for (let i = 0; i < 3; i++) await desktop.keyboard.press("Tab");
    assert.equal(await right.evaluate((node) => node === document.activeElement), true);
    await desktop.keyboard.press("Shift+Enter");
    await visualOutline.waitFor();
    assert.deepEqual(await selectedIds(), groupIds);
    assert.equal(
      await right
        .locator(".editable-name")
        .evaluate((element) => getComputedStyle(element).textDecorationLine),
      "underline",
    );
    await desktop.keyboard.press("ArrowRight");
    const keyboardMove = await waitForRevision(desktop, beforeKeyboard.revision + 1);
    assert.deepEqual(
      keyboardMove.artboards.slice(1).map(({ x }) => x),
      groupBoards.map(({ x }) => x + 5),
    );
    await desktop.keyboard.press("Meta+z");
    await waitForRevision(desktop, keyboardMove.revision + 1);
    await desktop.keyboard.press("Escape");
    await visualOutline.waitFor({ state: "detached" });
    assert.deepEqual(await selectedIds(), []);

    await left.click({ position: spot });
    await right.click({ position: spot, modifiers: ["Shift"] });
    await visualOutline.waitFor();
    assert.deepEqual(await selectedIds(), groupIds);
    await right.click({ position: spot, modifiers: ["Shift"] });
    assert.deepEqual(await selectedIds(), [groupIds[0]]);
    await right.click({ position: spot, modifiers: ["Shift"] });
    await visualOutline.waitFor();
    await left.click({ position: spot });
    await visualOutline.waitFor({ state: "detached" });
    assert.deepEqual(await selectedIds(), [groupIds[0]]);

    const leftBox = await left.boundingBox();
    const rightBox = await right.boundingBox();
    // The marquee crosses both artboards without enclosing either of them.
    await desktop.mouse.move(leftBox.x - 24, leftBox.y + leftBox.height + 18);
    await desktop.mouse.down();
    await desktop.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2, {
      steps: 12,
    });
    await desktop.locator(".react-flow__selection").waitFor();
    if (evidence) await desktop.screenshot({ path: join(evidence, "artboard-marquee.png") });
    await desktop.mouse.up();
    await selectionCount.waitFor();
    assert.deepEqual(await selectedIds(), groupIds);

    const beforeNudge = await snapshot();
    const selectionOutline = desktop.locator(".react-flow__nodesselection-rect");
    const verifyOutline = () =>
      visualOutline.evaluate((group) => {
        const artboards = [...document.querySelectorAll(".react-flow__node.selected .artboard")];
        const bounds = artboards.map((artboard) => artboard.getBoundingClientRect());
        const rect = group.getBoundingClientRect();
        const groupStyle = getComputedStyle(group);
        return {
          inset: [
            rect.left - Math.min(...bounds.map(({ left }) => left)),
            rect.top - Math.min(...bounds.map(({ top }) => top)),
            rect.right - Math.max(...bounds.map(({ right }) => right)),
            rect.bottom - Math.max(...bounds.map(({ bottom }) => bottom)),
          ],
          groupOutline: [
            groupStyle.borderWidth,
            groupStyle.outlineStyle,
            groupStyle.outlineWidth,
            groupStyle.outlineOffset,
          ],
          individualOutlines: artboards.map((artboard) => {
            const { outlineWidth, outlineOffset } = getComputedStyle(artboard);
            return [outlineWidth, outlineOffset];
          }),
        };
      });
    const assertFlush = async () => {
      const { inset, groupOutline, individualOutlines } = await verifyOutline();
      assert.ok(
        inset.every((edge) => Math.abs(edge) < 0.25),
        `Selection edge offsets: ${inset}`,
      );
      assert.deepEqual(groupOutline, ["0px", "dashed", "2px", "0px"]);
      assert.deepEqual(individualOutlines, [
        ["2px", "0px"],
        ["2px", "0px"],
      ]);
    };
    await assertFlush();
    if (evidence)
      await desktop.screenshot({ path: join(evidence, "artboard-selection-outline.png") });
    await selectionOutline.press("ArrowRight");
    const nudged = await waitForRevision(desktop, beforeNudge.revision + 1);
    assert.deepEqual(
      nudged.artboards.slice(1).map(({ x }) => x),
      groupBoards.map(({ x }) => x + 5),
    );
    await desktop.keyboard.press("Meta+z");
    await waitForRevision(desktop, nudged.revision + 1);

    const beforeGroupMove = await snapshot();
    const viewport = desktop.locator(".react-flow__viewport");
    const beforeZoom = await viewport.getAttribute("style");
    await pinchCanvas(desktop, -10);
    await desktop.waitForFunction(
      (oldStyle) =>
        document.querySelector(".react-flow__viewport").getAttribute("style") !== oldStyle,
      beforeZoom,
    );
    await assertFlush();
    const zoomedLeft = await left.boundingBox();
    await desktop.mouse.move(zoomedLeft.x + 40, zoomedLeft.y + 50);
    await desktop.mouse.down();
    await desktop.mouse.move(zoomedLeft.x + 65, zoomedLeft.y + 90, { steps: 8 });
    await desktop.mouse.up();
    const movedGroup = await waitForRevision(desktop, beforeGroupMove.revision + 1);
    const [first, second] = movedGroup.artboards.filter(({ id }) => groupIds.includes(id));
    const [dx, dy] = [first.x - groupBoards[0].x, first.y - groupBoards[0].y];
    assert.ok(dx > 0 && dy > 0, `Group drag moved by ${dx}, ${dy}`);
    assert.ok(Math.abs(second.x - first.x - 250) < 0.00001);
    assert.equal(second.y, first.y);
    assert.deepEqual(movedGroup.artboards[0], beforeGroupMove.artboards[0]);
    assert.deepEqual(
      [first.previewUrl, second.previewUrl],
      beforeGroupMove.artboards.slice(1).map(({ previewUrl }) => previewUrl),
    );

    await desktop.keyboard.press("Meta+d");
    await desktop.waitForFunction(
      () => document.querySelectorAll(".react-flow__node").length === 5,
    );
    await selectionCount.waitFor();
    const duplicated = await snapshot();
    assert.equal(duplicated.revision, movedGroup.revision + 1);
    const groupCopies = duplicated.artboards.slice(3);
    const copyIds = groupCopies.map(({ id }) => id);
    assert.deepEqual(await selectedIds(), copyIds);
    await assertFlush();
    assert.deepEqual(
      groupCopies.map(({ x, y }) => [x, y]),
      [
        [first.x + 40, first.y + 40],
        [second.x + 40, second.y + 40],
      ],
    );
    const copiedGroup = await desktop.evaluate(() => {
      const data = new DataTransfer();
      document.body.dispatchEvent(
        new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }),
      );
      return data.getData("application/x-easy-proto-artboard");
    });
    assert.match(copiedGroup, /^[0-9a-f-]{36}$/);
    const copyTargets = [
      [],
      [copyIds[0], copyIds[0]],
      Array.from({ length: 51 }, () => randomUUID()),
      [copyIds[0], randomUUID()],
    ];
    await assert.rejects(
      desktop.evaluate(
        ({ generation, ids, token }) => window.easyProto.copyArtboards(generation, ids, token),
        {
          generation: duplicated.generation - 1,
          ids: copyIds,
          token: randomUUID(),
        },
      ),
      /project selection changed/i,
    );
    for (const ids of copyTargets) {
      await assert.rejects(
        desktop.evaluate(
          ({ generation, ids, token }) => window.easyProto.copyArtboards(generation, ids, token),
          {
            generation: duplicated.generation,
            ids,
            token: randomUUID(),
          },
        ),
        /validation|artboard IDs must be unique|Too small|Too big|no longer exists/i,
      );
    }
    await desktop.evaluate((id) => {
      const data = new DataTransfer();
      data.setData("application/x-easy-proto-artboard", id);
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, copiedGroup);
    await desktop.waitForFunction(
      () => document.querySelectorAll(".react-flow__node").length === 7,
    );
    await assertFlush();
    await desktop.keyboard.press("Meta+z");
    await desktop.waitForFunction(
      () => document.querySelectorAll(".react-flow__node").length === 5,
    );
    // Undo removes the pasted boards. Pick the first set of copies again.
    await boardNode(copyIds[0]).click({ position: { x: 55, y: 55 } });
    await boardNode(copyIds[1]).click({ position: { x: 55, y: 55 }, modifiers: ["Shift"] });
    await selectionCount.waitFor();
    assert.deepEqual(await selectedIds(), copyIds);
    await assertFlush();
    const beforeDelete = await snapshot();
    await desktop.keyboard.press("Delete");
    await desktop.waitForFunction(
      () => document.querySelectorAll(".react-flow__node").length === 3,
    );
    assert.equal((await snapshot()).revision, beforeDelete.revision + 1);
    await desktop.keyboard.press("Meta+z");
    await desktop.waitForFunction(
      () => document.querySelectorAll(".react-flow__node").length === 5,
    );
    await selectionCount.waitFor();
    assert.deepEqual(await selectedIds(), copyIds);
    await assertFlush();
    if (evidence) {
      await desktop.screenshot({ path: join(evidence, "artboard-multi-select.png") });
      await desktop.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await desktop.locator('html[data-theme="dark"]').waitFor();
      await desktop.screenshot({ path: join(evidence, "artboard-multi-select-dark.png") });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((window) => window.isVisible())
          .setSize(660, 480);
      });
      await desktop.waitForFunction(() => innerWidth <= 660);
      await fitCanvas(desktop);
      await assertFlush();
      await desktop.screenshot({ path: join(evidence, "artboard-multi-select-dark-minimum.png") });
    }
    await desktop.keyboard.press("Meta+Shift+z");
    await desktop.waitForFunction(
      () => document.querySelectorAll(".react-flow__node").length === 3,
    );
    await returnHome();
    await row("Studio project").click();
    await right.waitFor();
    const reopenedGroup = await snapshot();
    await assert.rejects(
      desktop.evaluate(
        ({ generation, command }) => window.easyProto.arrangeArtboard(generation, command),
        {
          generation: reopenedGroup.generation,
          command: {
            projectId,
            commandId: randomUUID(),
            expectedRevision: reopenedGroup.revision,
            operation: "paste_artboard",
            arguments: { clipboardId: copiedGroup },
          },
        },
      ),
      /copy an artboard in this project first/i,
    );
    await assert.rejects(
      desktop.evaluate(
        ({ generation, command }) => window.easyProto.arrangeArtboard(generation, command),
        {
          generation: duplicated.generation,
          command: {
            projectId,
            commandId: randomUUID(),
            expectedRevision: reopenedGroup.revision,
            operation: "delete_artboards",
            arguments: { artboardIds: groupIds },
          },
        },
      ),
      /project selection changed/i,
    );
    assert.equal((await snapshot()).revision, reopenedGroup.revision);
    assert.deepEqual(
      (await snapshot()).artboards.map(({ id, x, y }) => [id, x, y]),
      movedGroup.artboards.map(({ id, x, y }) => [id, x, y]),
    );
    assert.equal(await selectedNodes.count(), 0);

    const picker = (name) =>
      desktop.getByRole("button", { name: `Pages, current page ${name}`, exact: true });
    const pageMenu = () => desktop.getByRole("group", { name: "Pages", exact: true });
    const emptyPage = desktop.getByText("No artboards on this page", { exact: true });
    async function switchPage(from, to) {
      await picker(from).click();
      await pageMenu().getByRole("button", { name: to, exact: true }).click();
      await picker(to).waitFor();
      await pageMenu().waitFor({ state: "hidden" });
    }
    async function addPage(from, name) {
      await picker(from).click();
      await pageMenu().getByRole("button", { name: "Add page", exact: true }).click();
      const field = pageMenu().getByRole("textbox", { name: "Page name" });
      assert.ok(await field.evaluate((element) => element === document.activeElement));
      await field.fill(name);
      await field.press("Enter");
      await picker(name).waitFor();
      await pageMenu().waitFor({ state: "hidden" });
    }

    await picker("Page 1").waitFor();
    const legacy = await snapshot();
    assert.deepEqual(legacy.pages, [{ id: legacy.defaultPageId, name: "Page 1" }]);
    const activeBefore = await call("get_context");
    const camera = () => desktop.locator(".react-flow__viewport").getAttribute("style");
    const beforePagePan = await camera();
    const area = await desktop.locator(".canvas").boundingBox();
    await desktop.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await desktop.mouse.wheel(26, 18);
    await desktop.waitForFunction(
      (before) => document.querySelector(".react-flow__viewport").getAttribute("style") !== before,
      beforePagePan,
    );
    const firstPageCamera = await camera();

    await addPage("Page 1", "Exploration");
    await emptyPage.waitFor();
    assert.equal(await desktop.locator(".react-flow__node").count(), 0);
    const createdPage = await waitForRevision(desktop, legacy.revision + 1);
    const target = createdPage.pages.find(({ name }) => name === "Exploration");
    assert.ok(target.id);
    assert.equal((await call("get_context")).activationId, activeBefore.activationId);

    const activeScopeForPages = { projectId, activationId: activeBefore.activationId };
    const fromMcp = (name) => ({
      name,
      width: 160,
      height: 150,
      x: 1400,
      y: 0,
      html: `<main>${name}</main>`,
      css: "body { background: var(--ep-color-action, #000); }",
    });
    const onDefault = await call("create_artboard", {
      ...activeScopeForPages,
      commandId: randomUUID(),
      expectedRevision: createdPage.revision,
      arguments: fromMcp("Default page board"),
    });
    assert.equal(onDefault.artboard.pageId, legacy.defaultPageId);
    assert.equal(await desktop.locator('iframe[title="Default page board"]').count(), 0);
    const onTarget = await call("create_artboard", {
      ...activeScopeForPages,
      commandId: randomUUID(),
      expectedRevision: onDefault.revision,
      arguments: { ...fromMcp("Destination board"), pageId: target.id },
    });
    assert.equal(onTarget.artboard.pageId, target.id);
    await desktop
      .frameLocator('iframe[title="Destination board"]')
      .getByText("Destination board")
      .waitFor();

    await switchPage("Exploration", "Page 1");
    await desktop.waitForFunction(
      (expected) =>
        document.querySelector(".react-flow__viewport")?.getAttribute("style") === expected,
      firstPageCamera,
      { timeout: 5000 },
    );
    assert.equal((await snapshot()).revision, onTarget.revision);
    assert.equal(await desktop.locator('iframe[title="Destination board"]').count(), 0);
    await picker("Page 1").press("Enter");
    await pageMenu().waitFor();
    assert.equal(
      await pageMenu()
        .getByRole("button", { name: "Page 1", exact: true })
        .getAttribute("aria-current"),
      "page",
    );
    const exploration = pageMenu().getByRole("button", { name: "Exploration", exact: true });
    const renameExploration = pageMenu().getByRole("button", {
      name: "Page settings for Exploration",
    });
    const renameOpacity = () =>
      renameExploration.evaluate((button) => getComputedStyle(button).opacity);
    await desktop.mouse.move(2, 2);
    assert.equal(await renameOpacity(), "0");
    if (evidence) {
      await desktop.emulateMedia({ colorScheme: "dark" });
      await desktop.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await desktop.screenshot({ path: join(evidence, "pages-picker.png") });
    }
    await exploration.hover();
    assert.equal(await renameOpacity(), "1");
    assert.equal((await renameExploration.boundingBox()).width, 24);
    if (evidence) {
      await desktop.emulateMedia({ colorScheme: "light" });
      await desktop.waitForFunction(() => document.documentElement.dataset.theme === "light");
      await desktop.screenshot({ path: join(evidence, "pages-picker-light-hover.png") });
      await desktop.emulateMedia({ colorScheme: null });
    }
    await desktop.mouse.move(2, 2);
    await exploration.press("Tab");
    assert.equal(
      await renameExploration.evaluate((button) => button === document.activeElement),
      true,
    );
    assert.equal(await renameOpacity(), "1");
    await desktop.keyboard.press("Escape");
    await pageMenu().waitFor({ state: "hidden" });

    await left.click({ position: { x: 25, y: 25 } });
    await right.click({ position: { x: 25, y: 25 }, modifiers: ["Shift"] });
    await selectionCount.waitFor();
    const beforePageMove = await snapshot();
    const moveButton = desktop.getByRole("button", { name: "Move to page", exact: true });
    const menuForMove = desktop.getByRole("group", { name: "Move 2 artboards to" });
    await moveButton.press("Enter");
    await menuForMove.waitFor();
    assert.equal(await menuForMove.getByRole("button", { name: "Page 1", exact: true }).count(), 0);
    if (evidence) await desktop.screenshot({ path: join(evidence, "move-to-page.png") });
    await desktop.keyboard.press("Escape");
    await menuForMove.waitFor({ state: "hidden" });
    await moveButton.click();
    await menuForMove.getByRole("button", { name: "Exploration", exact: true }).click();
    const committedMove = await waitForRevision(desktop, beforePageMove.revision + 1);
    await left.waitFor({ state: "detached" });
    await right.waitFor({ state: "detached" });
    await picker("Page 1").waitFor();
    const boardsOnTarget = committedMove.artboards.filter(({ id }) => groupIds.includes(id));
    assert.deepEqual(
      boardsOnTarget,
      beforePageMove.artboards
        .filter(({ id }) => groupIds.includes(id))
        .map((board) => ({ ...board, pageId: target.id })),
    );
    if (evidence) await desktop.screenshot({ path: join(evidence, "page-move-confirmation.png") });
    await desktop.getByRole("button", { name: "Go to page", exact: true }).click();
    await picker("Exploration").waitFor();
    await right.waitFor();
    assert.equal(await desktop.locator(".react-flow__node").count(), 3);

    await desktop.keyboard.press("Meta+z");
    const undone = await waitForRevision(desktop, committedMove.revision + 1);
    await right.waitFor({ state: "detached" });
    assert.deepEqual(undone.artboards, beforePageMove.artboards);
    await switchPage("Exploration", "Page 1");
    await right.waitFor();

    await desktop.keyboard.press("Meta+Shift+z");
    const redone = await waitForRevision(desktop, undone.revision + 1);
    await right.waitFor({ state: "detached" });
    assert.deepEqual(redone.artboards, committedMove.artboards);
    await switchPage("Page 1", "Exploration");
    await right.waitFor();

    await addPage("Exploration", "Scratch");
    const scratch = await waitForRevision(desktop, redone.revision + 1);
    await desktop.keyboard.press("Meta+z");
    await picker("Page 1").waitFor();
    assert.equal((await waitForRevision(desktop, scratch.revision + 1)).pages.length, 2);
    await desktop.keyboard.press("Meta+Shift+z");
    const restoredPage = await waitForRevision(desktop, scratch.revision + 2);
    assert.deepEqual(restoredPage.pages, scratch.pages);

    await picker("Page 1").click();
    const renameScratch = pageMenu().getByRole("button", { name: "Page settings for Scratch" });
    const renameField = pageMenu().getByRole("textbox", { name: "Rename page", exact: true });
    await renameScratch.press("Enter");
    const scratchActions = desktop.getByRole("menu", {
      name: "Page actions for Scratch",
      exact: true,
    });
    await scratchActions.getByRole("menuitem", { name: "Rename", exact: true }).click();
    assert.equal(await renameField.evaluate((input) => input === document.activeElement), true);
    assert.equal(await renameField.inputValue(), "Scratch");
    await renameField.fill("Discarded");
    await renameField.press("Escape");
    await pageMenu().waitFor();
    await desktop.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "Page settings for Scratch",
    );
    assert.equal((await snapshot()).revision, restoredPage.revision);
    await renameScratch.click();
    await scratchActions.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await renameField.fill("Notes");
    if (evidence) await desktop.screenshot({ path: join(evidence, "page-rename.png") });
    await renameField.press("Enter");
    await pageMenu().getByRole("button", { name: "Notes", exact: true }).waitFor();
    await picker("Page 1").waitFor();
    const renamedPage = await waitForRevision(desktop, restoredPage.revision + 1);
    const notes = renamedPage.pages.find(({ name }) => name === "Notes");
    assert.equal(notes.id, restoredPage.pages.find(({ name }) => name === "Scratch").id);
    assert.deepEqual(renamedPage.artboards, restoredPage.artboards);
    await desktop.keyboard.press("Escape");
    await pageMenu().waitFor({ state: "hidden" });
    await desktop.keyboard.press("Meta+z");
    const undoRename = await waitForRevision(desktop, renamedPage.revision + 1);
    assert.deepEqual(undoRename.pages, restoredPage.pages);
    await desktop.keyboard.press("Meta+Shift+z");
    const redoRename = await waitForRevision(desktop, undoRename.revision + 1);
    assert.deepEqual(redoRename.pages, renamedPage.pages);

    const seeded = await call("replace_project_tokens", {
      ...activeScopeForPages,
      commandId: randomUUID(),
      expectedRevision: redoRename.revision,
      document: JSON.stringify({
        color: {
          $type: "color",
          blue: { $value: { colorSpace: "srgb", components: [0, 0, 1] } },
          action: { $value: "{color.blue}" },
        },
      }),
    });
    assert.equal(seeded.status, "committed");
    const colorFor = async (name, color) => {
      const element = desktop.frameLocator(`iframe[title="${name}"]`).locator("body");
      const deadline = Date.now() + 5000;
      let actual;
      do {
        actual = await element.evaluate((body) => getComputedStyle(body).backgroundColor);
        if (actual === color) return actual;
        await new Promise((resolve) => setTimeout(resolve, 40));
      } while (Date.now() < deadline);
      assert.equal(actual, color);
    };
    await switchPage("Page 1", "Exploration");
    await colorFor("Destination board", "rgb(0, 0, 255)");
    await switchPage("Exploration", "Page 1");
    await colorFor("Default page board", "rgb(0, 0, 255)");

    const tokens = desktop.getByRole("dialog", { name: "Project tokens" });
    await desktop.getByRole("button", { name: "Tokens", exact: true }).click();
    const insets = () =>
      tokens.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return [bounds.left, innerWidth - bounds.right, bounds.top, innerHeight - bounds.bottom];
      });
    assert.deepEqual(await insets(), [20, 20, 20, 20]);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.isVisible())
        .setSize(1180, 770),
    );
    await desktop.waitForFunction(() => innerWidth === 1180);
    assert.deepEqual(await insets(), [20, 20, 20, 20]);
    const search = tokens.getByRole("searchbox", { name: "Search tokens" });
    await tokens.locator(".token-search svg").waitFor();
    await search.fill("blue");
    assert.equal(
      await tokens.getByRole("button", { name: "color.action", exact: true }).count(),
      0,
    );
    await search.clear();
    await tokens.getByRole("button", { name: "color.blue", exact: true }).click();
    const editRow = tokens.getByRole("form", { name: "Edit color.blue" });
    const value = editRow.getByRole("textbox", { name: "Value" });
    assert.equal(
      await value.evaluate(
        (input) => input === document.activeElement && !!input.closest("tbody tr"),
      ),
      true,
    );
    assert.equal(
      await tokens.getByRole("button", { name: "color.action", exact: true }).isVisible(),
      true,
    );
    const typePicker = editRow.getByRole("combobox", { name: "Type" });
    assert.equal(
      await editRow
        .locator(".token-row-actions")
        .evaluate(
          (actions) =>
            new Set([...actions.children].map((button) => button.getBoundingClientRect().top)).size,
        ),
      1,
    );
    assert.equal(
      await typePicker.evaluate((select) => getComputedStyle(select).appearance),
      "base-select",
    );
    await typePicker.press("Space");
    await desktop.waitForFunction(
      () => document.querySelector(".ep-select")?.matches(":open"),
      undefined,
      { timeout: 5000 },
    );
    if (evidence) await desktop.screenshot({ path: join(evidence, "token-type-picker.png") });
    await desktop.keyboard.press("Escape");
    await desktop.waitForFunction(
      () => document.querySelector(".ep-select")?.matches(":open") === false,
      undefined,
      { timeout: 5000 },
    );
    assert.equal(await typePicker.inputValue(), "color");
    await typePicker.press("Space");
    await desktop.keyboard.press("ArrowDown");
    await desktop.keyboard.press("Enter");
    assert.equal(await typePicker.inputValue(), "dimension");
    await typePicker.selectOption("color");
    await value.fill("#ff0000");
    await editRow.getByRole("button", { name: "Save token", exact: true }).click();
    await tokens.locator(".toast").getByText("Tokens saved.").waitFor();
    const savedTokens = await call("get_tokens", activeScopeForPages);
    assert.equal(savedTokens.revision, seeded.revision + 1);
    assert.match(savedTokens.css, /--ep-color-action: var\(--ep-color-blue\);/);
    if (evidence) await desktop.screenshot({ path: join(evidence, "token-manager.png") });
    await tokens.getByRole("button", { name: "Copy CSS for color.action" }).click();
    await tokens.locator(".toast").getByText("CSS copied", { exact: true }).waitFor();
    assert.equal(
      await app.evaluate(({ clipboard }) => clipboard.readText()),
      "var(--ep-color-action)",
    );
    if (evidence) await desktop.screenshot({ path: join(evidence, "token-copy-toast.png") });
    await tokens.getByRole("button", { name: "Dismiss notification" }).click();
    await tokens.locator(".toast").waitFor({ state: "hidden" });

    const imported = join(root, "import.tokens.json");
    const exportedJson = join(root, "export.tokens.json");
    const exportedCss = join(root, "export.css");
    await writeFile(imported, '{"number":{"$type":"number","$value":42}}');
    await app.evaluate(
      ({ dialog }, files) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.imported] });
        dialog.showSaveDialog = async (_window, { defaultPath }) => ({
          canceled: false,
          filePath: defaultPath === "tokens.css" ? files.exportedCss : files.exportedJson,
        });
      },
      { imported, exportedJson, exportedCss },
    );
    await tokens.getByRole("button", { name: "JSON…", exact: true }).click();
    await tokens.getByRole("button", { name: "Import JSON…" }).click();
    const text = tokens.getByLabel("Design tokens JSON");
    await desktop.waitForFunction(() =>
      document.querySelector(".tokens-dialog textarea")?.value.includes("42"),
    );
    assert.equal(await text.inputValue(), await readFile(imported, "utf8"));
    await tokens.getByRole("button", { name: "Export saved JSON…" }).click();
    await tokens.getByRole("button", { name: "Export CSS…" }).click();
    await tokens.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await readFile(exportedJson, "utf8"), savedTokens.document);
    assert.equal(await readFile(exportedCss, "utf8"), savedTokens.css);
    assert.equal((await call("get_tokens", activeScopeForPages)).revision, savedTokens.revision);
    await tokens.getByRole("button", { name: "Close tokens" }).click();
    const defaultColor = await colorFor("Default page board", "rgb(255, 0, 0)");
    await switchPage("Page 1", "Exploration");
    const destinationColor = await colorFor("Destination board", "rgb(255, 0, 0)");
    const capture = await client.callTool({
      name: "capture_artboard",
      arguments: {
        ...activeScopeForPages,
        artboardId: onTarget.artboard.id,
        revision: savedTokens.revision,
      },
    });
    assert.equal(capture.isError, undefined, JSON.stringify(capture.content));
    const details = capture.structuredContent;
    assert.deepEqual(details.tokens, savedTokens.stamp);
    assert.equal(details.sourceRevision, onTarget.artboard.sourceRevision);
    assert.deepEqual(details.unresolved, []);
    const image = capture.content.find(({ type }) => type === "image");
    const pixel = await app.evaluate(({ nativeImage }, data) => {
      const png = nativeImage.createFromBuffer(Buffer.from(data, "base64"));
      const size = png.getSize();
      const offset = ((size.height - 1) * size.width + size.width - 1) * 4;
      return { ...size, bgra: [...png.toBitmap().subarray(offset, offset + 4)] };
    }, image.data);
    assert.deepEqual(pixel, { width: 160, height: 150, bgra: [0, 0, 255, 255] });
    if (evidence) {
      await writeFile(join(evidence, "token-artboard.png"), Buffer.from(image.data, "base64"));
      await writeFile(
        join(evidence, "token-render.json"),
        JSON.stringify({ defaultColor, destinationColor, pixel, ...details }, null, 2),
      );
    }

    await desktop.keyboard.press("Meta+z");
    await waitForRevision(desktop, savedTokens.revision + 1);
    await colorFor("Destination board", "rgb(0, 0, 255)");
    await desktop.keyboard.press("Meta+Shift+z");
    await waitForRevision(desktop, savedTokens.revision + 2);
    await colorFor("Destination board", "rgb(255, 0, 0)");

    await client.close();
    client = undefined;
    await app.close();
    app = undefined;
    await launch();
    await row("Studio project").click();
    await picker("Page 1").waitFor();
    await switchPage("Page 1", "Exploration");
    await boardNode(groupIds[1]).waitFor();
    const afterRestart = await snapshot();
    assert.deepEqual(afterRestart.pages, redoRename.pages);
    assert.deepEqual(
      afterRestart.artboards.map(({ id, pageId, sourceRevision }) => [id, pageId, sourceRevision]),
      redone.artboards.map(({ id, pageId, sourceRevision }) => [id, pageId, sourceRevision]),
    );
    assert.equal(afterRestart.canUndo, false);
    assert.equal(afterRestart.tokenDigest, savedTokens.stamp.documentDigest);
    await colorFor("Destination board", "rgb(255, 0, 0)");
    await switchPage("Exploration", "Page 1");
    await colorFor("Default page board", "rgb(255, 0, 0)");
    await desktop.getByRole("button", { name: "Tokens", exact: true }).click();
    const reopenedTokens = desktop.getByRole("dialog", { name: "Project tokens" });
    await reopenedTokens.getByRole("button", { name: "Add token", exact: true }).click();
    await reopenedTokens.getByLabel("Name", { exact: true }).fill("space.gutter");
    await reopenedTokens.getByLabel("Type", { exact: true }).selectOption("dimension");
    await reopenedTokens.getByLabel("Value", { exact: true }).fill("1.5rem");
    await reopenedTokens.getByRole("button", { name: "Save token", exact: true }).click();
    const gutter = reopenedTokens.getByRole("button", { name: "space.gutter", exact: true });
    await gutter.click();
    await reopenedTokens.getByRole("button", { name: "Delete token", exact: true }).click();
    await gutter.waitFor({ state: "detached" });
    await reopenedTokens.locator(".toast").waitFor();
    await reopenedTokens.locator(".toast").waitFor({ state: "hidden", timeout: 6500 });
  },
);
