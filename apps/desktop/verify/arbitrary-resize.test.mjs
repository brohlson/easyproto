import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { launchDesktop } from "./launch-desktop.mjs";
import { Project } from "../dist/project.js";

test(
  "Arbitrary size resizes the HTML viewport, saves one gesture and stays independent of zoom",
  {
    timeout: 40_000,
  },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "easy-proto-arbitrary-size-"));
    const folder = join(root, "Viewport");
    const project = await Project.open(folder);
    const {
      projectId,
      artboards: [board],
    } = project.snapshot.manifest;
    await project.execute({
      projectId,
      commandId: randomUUID(),
      expectedRevision: 0,
      operation: "update_artboard",
      arguments: {
        artboardId: board.id,
        patch: {
          width: 320,
          height: 240,
          html: '<main><h1 class="compact">Compact layout</h1><h1 class="wide">Wide layout</h1></main>',
          css: "body{margin:0;background:#eee;font:24px system-ui}.wide{display:none}@media(min-width:380px){.compact{display:none}.wide{display:block}}",
        },
      },
    });
    const reserve = createServer();
    reserve.listen(0, "127.0.0.1");
    await once(reserve, "listening");
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    const token = randomBytes(32).toString("base64url");
    const env = {
      ...process.env,
      EASY_PROTO_PROFILE: join(root, "profile"),
      EASY_PROTO_PORT: String(port),
      EASY_PROTO_TOKEN: token,
    };
    let app;
    const client = new Client({ name: "arbitrary-resize-verification", version: "1.0.0" });
    t.after(async () => {
      await client.close();
      await app?.close();
      await rm(root, { recursive: true, force: true });
    });
    app = await launchDesktop({ args: [process.cwd(), "--project=" + folder], env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(5000);
    const scene = () => page.evaluate(() => window.easyProto.getScene());
    const node = page.locator(".react-flow__node").filter({
      has: page.getByRole("button", { name: "Rename artboard Field notes", exact: true }),
    });
    const dimensions = node.getByRole("button", { name: /^Device size,/ });
    const menu = node.getByRole("group", { name: "Device sizes", exact: true });
    const handle = node.getByRole("button", { name: "Resize artboard Field notes", exact: true });
    const iframe = node.locator("iframe");
    const content = await iframe
      .contentFrame()
      .locator("body")
      .waitFor()
      .then(async () => page.frames().find((frame) => frame.url().includes(board.id)));
    const viewport = () => content.evaluate(() => [innerWidth, innerHeight]);
    async function waitViewport(width, height) {
      const deadline = Date.now() + 5000;
      let actual;
      do {
        actual = await viewport();
        if (actual[0] === width && actual[1] === height) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      } while (Date.now() < deadline);
      assert.deepEqual(actual, [width, height]);
    }
    const zoom = () =>
      page.evaluate(
        () =>
          new DOMMatrix(getComputedStyle(document.querySelector(".react-flow__viewport")).transform)
            .a,
      );
    function settleCamera() {
      return page.evaluate(async () => {
        let previous = "";
        let stable = 0;
        while (stable < 4) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const current = document.querySelector(".react-flow__viewport").style.transform;
          stable = current === previous ? stable + 1 : 0;
          previous = current;
        }
      });
    }
    async function revision(expected) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (
          (await scene()).revision === expected &&
          (!(await handle.count()) || (await handle.isEnabled()))
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail("The viewport edit did not commit revision " + expected);
    }
    await dimensions.waitFor();
    assert.equal(await handle.count(), 0);
    const initial = await scene();
    const originalUrl = await iframe.getAttribute("src");
    await dimensions.click();
    await menu.getByRole("button", { name: "Arbitrary size", exact: true }).click();
    await handle.waitFor();
    assert.equal(await handle.evaluate((element) => document.activeElement === element), true);
    assert.equal((await scene()).revision, initial.revision);
    await settleCamera();
    const before = await handle.boundingBox();
    assert.ok(Math.abs(before.width - 24) < 0.5);
    const boardBox = await iframe.boundingBox();
    assert.ok(Math.abs(before.x + before.width / 2 - boardBox.x - boardBox.width) < 0.5);
    assert.ok(Math.abs(before.y + before.height / 2 - boardBox.y - boardBox.height) < 0.5);
    const scale = await zoom();
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      before.x + before.width / 2 + 80 * scale,
      before.y + before.height / 2 + 50 * scale,
      { steps: 8 },
    );
    await content.getByRole("heading", { name: "Wide layout" }).waitFor();
    await waitViewport(400, 290);
    assert.equal((await scene()).revision, initial.revision);
    await page.mouse.up();
    await revision(initial.revision + 1);
    await waitViewport(400, 290);
    const saved = await scene();
    assert.deepEqual([saved.artboards[0].x, saved.artboards[0].y], [board.x, board.y]);
    assert.equal(saved.artboards[0].sourceRevision, initial.artboards[0].sourceRevision);
    assert.equal(await iframe.getAttribute("src"), originalUrl);
    assert.equal(page.frames().includes(content), true);
    await handle.focus();
    await page.keyboard.press("Meta+z");
    await revision(initial.revision + 2);
    await waitViewport(320, 240);
    await page.keyboard.press("Meta+Shift+z");
    await revision(initial.revision + 3);
    await waitViewport(400, 290);

    const canvas = await page.locator(".canvas").boundingBox();
    const renderedBefore = await iframe.boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -40);
    await page.keyboard.up("Control");
    await page.waitForFunction(
      (previous) =>
        new DOMMatrix(getComputedStyle(document.querySelector(".react-flow__viewport")).transform)
          .a > previous,
      scale,
    );
    await settleCamera();
    const biggerScale = await zoom();
    assert.ok((await iframe.boundingBox()).width > renderedBefore.width);
    assert.deepEqual(await viewport(), [400, 290]);
    assert.equal((await scene()).revision, initial.revision + 3);
    assert.ok(Math.abs((await handle.boundingBox()).width - 24) < 0.5);
    const second = await handle.boundingBox();
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      second.x + second.width / 2 + 40 * biggerScale,
      second.y + second.height / 2 + 30 * biggerScale,
      { steps: 6 },
    );
    await page.mouse.up();
    await revision(initial.revision + 4);
    const secondSize = await viewport();
    assert.ok(
      Math.abs(secondSize[0] - 440) <= 1 && Math.abs(secondSize[1] - 320) <= 1,
      JSON.stringify({ secondSize, biggerScale, currentZoom: await zoom() }),
    );
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await revision(initial.revision + 5);
    await waitViewport(secondSize[0] + 5, secondSize[1]);
    assert.equal(await handle.evaluate((element) => document.activeElement === element), true);
    await page.keyboard.press("Shift+ArrowDown");
    await revision(initial.revision + 6);
    const finalSize = [secondSize[0] + 5, secondSize[1] + 20];
    await waitViewport(...finalSize);
    const arbitrarySaved = await Project.open(folder);
    assert.deepEqual(
      [
        arbitrarySaved.snapshot.manifest.artboards[0].width,
        arbitrarySaved.snapshot.manifest.artboards[0].height,
      ],
      finalSize,
    );
    await handle.focus();
    await page.keyboard.press("Shift+Digit0");
    await settleCamera();

    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: "Bearer " + token } },
      }),
    );
    const { structuredContent: context } = await client.callTool({ name: "get_context" });
    const captured = await client.callTool({
      name: "capture_artboard",
      arguments: {
        projectId,
        activationId: context.activationId,
        artboardId: board.id,
        revision: context.revision,
      },
    });
    assert.equal(captured.isError, undefined);
    assert.deepEqual(
      [captured.structuredContent.width, captured.structuredContent.height],
      finalSize,
    );
    assert.deepEqual(captured.structuredContent.unresolved, []);
    const evidence = process.env.EASY_PROTO_EVIDENCE;
    if (evidence) {
      await page.screenshot({ path: join(evidence, "arbitrary-resize.png") });
      await writeFile(
        join(evidence, "capture.json"),
        JSON.stringify(captured.structuredContent, null, 2) + "\n",
      );
    }
    const conflicting = await handle.boundingBox();
    await page.mouse.move(
      conflicting.x + conflicting.width / 2,
      conflicting.y + conflicting.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      conflicting.x + conflicting.width / 2 + 15,
      conflicting.y + conflicting.height / 2 + 15,
      { steps: 3 },
    );
    const concurrent = await client.callTool({
      name: "update_artboard",
      arguments: {
        projectId,
        activationId: context.activationId,
        commandId: randomUUID(),
        expectedRevision: context.revision,
        arguments: { artboardId: board.id, patch: { width: 430, height: 330 } },
      },
    });
    assert.equal(concurrent.isError, undefined);
    await page.mouse.up();
    const conflict = page.getByRole("alert");
    await conflict.getByText(/updated while you were editing/).waitFor();
    await revision(initial.revision + 7);
    await waitViewport(430, 330);
    await conflict.getByRole("button", { name: "Dismiss" }).click();
    await dimensions.click();
    await menu.getByRole("button", { name: /iPhone SE/ }).click();
    await revision(initial.revision + 8);
    await handle.waitFor({ state: "detached" });
    await waitViewport(375, 667);
    assert.equal(await iframe.getAttribute("src"), originalUrl);
    const stored = await Project.open(folder);
    assert.deepEqual(
      [stored.snapshot.manifest.artboards[0].width, stored.snapshot.manifest.artboards[0].height],
      [375, 667],
    );
    await client.close();
    await app.close();
    app = await launchDesktop({ args: [process.cwd(), "--project=" + folder], env });
    const reopened = await app.firstWindow();
    await reopened.getByRole("button", { name: "Device size, 375 × 667", exact: true }).waitFor();
  },
);
