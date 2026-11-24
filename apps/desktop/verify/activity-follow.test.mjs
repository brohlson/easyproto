import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { _electron as electron } from "playwright";
import { Project } from "../dist/project.js";

test(
  "MCP activity follows its page once and overlays Edge runner outside preview content",
  { timeout: 30_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "easy-proto-activity-follow-"));
    const client = new Client({ name: "activity-follow", version: "1" });
    let app;
    t.after(async () => {
      await client.close();
      await app?.close();
      await rm(root, { recursive: true, force: true });
    });
    const project = await Project.open(join(root, "Mockups"));
    const projectId = project.snapshot.manifest.projectId;
    let revision = project.snapshot.manifest.revision;
    const savedPage = await project.execute({
      projectId,
      commandId: randomUUID(),
      expectedRevision: revision++,
      operation: "create_page",
      arguments: { name: "Work" },
    });
    const created = await project.execute({
      projectId,
      commandId: randomUUID(),
      expectedRevision: revision++,
      operation: "create_artboard",
      arguments: {
        name: "Target",
        pageId: savedPage.page.id,
        width: 360,
        height: 300,
        x: 4000,
        y: 2000,
        html: "<h1>Ready for ideas</h1>",
        css: "body{background:#fff;color:#222;font:16px system-ui}",
      },
    });
    const artboardId = created.artboard.id;
    const reserve = createServer().listen(0, "127.0.0.1");
    await once(reserve, "listening");
    const { port } = reserve.address();
    await new Promise((done) => reserve.close(done));
    const token = randomBytes(32).toString("base64url");
    app = await electron.launch({
      args: [process.cwd(), `--project=${project.root}`],
      env: {
        ...process.env,
        EASY_PROTO_TOKEN: token,
        EASY_PROTO_PORT: String(port),
        EASY_PROTO_PROFILE: join(root, "profile"),
      },
    });
    const page = await app.firstWindow();
    const picker = page.getByRole("button", { name: /^Pages, current page / });
    await picker.waitFor();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const initial = (await client.callTool({ name: "get_context" })).structuredContent;
    const scope = { projectId, activationId: initial.activationId };
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: { ...scope, ...args } });
      assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
      return result;
    };
    const activity = { artboardId, activityId: randomUUID() };
    const set = (status) => call("set_artboard_activity", { ...activity, status });
    await set("working");
    await page.getByRole("button", { name: "Pages, current page Work", exact: true }).waitFor();
    const node = page.locator(`[data-id="${artboardId}"]`);
    const status = node.getByRole("status");
    await status.waitFor();
    await page.waitForFunction((id) => {
      const board = document.querySelector(`[data-id="${id}"]`).getBoundingClientRect();
      const canvas = document.querySelector("[data-testid=canvas]").getBoundingClientRect();
      return Math.abs(board.x + board.width / 2 - canvas.x - canvas.width / 2) < 2;
    }, artboardId);
    assert.equal((await call("get_context")).structuredContent.activePageId, savedPage.page.id);
    assert.equal(
      await node.locator("[data-testid=artboard-preview]").getAttribute("aria-busy"),
      "true",
    );
    const preview = node.locator("iframe");
    const originalFrame = page.frameLocator('iframe[title="Target"]');
    await originalFrame.getByRole("heading", { name: "Ready for ideas" }).waitFor();
    assert.equal(await originalFrame.locator("[data-testid=edge-runner]").count(), 0);
    const documentHandle = await originalFrame.locator("html").elementHandle();
    const runner = status.locator("[data-testid=edge-runner-highlight]");
    assert.equal(await runner.evaluate((element) => element.getAnimations().length), 1);
    const sequence = await page.evaluate(
      async () => (await window.easyProto.getScene()).agentFocus.sequence,
    );

    // The user may leave the working page; renewing the lease must not pull them back.
    await picker.click();
    await page.getByRole("button", { name: initial.pages[0].name, exact: true }).click();
    await set("working");
    assert.equal((await call("get_context")).structuredContent.activePageId, initial.defaultPageId);
    assert.equal(
      await page.evaluate(async () => (await window.easyProto.getScene()).agentFocus.sequence),
      sequence,
    );
    await picker.click();
    await page.getByRole("button", { name: "Work", exact: true }).click();
    await status.waitFor();
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await runner.evaluate((element) => element.getAnimations().length), 0);
    await page.emulateMedia({ reducedMotion: "no-preference" });

    if (process.env.EASY_PROTO_EVIDENCE) {
      const evidence = resolve(process.env.EASY_PROTO_EVIDENCE);
      await mkdir(evidence, { recursive: true });
      for (const theme of ["light", "dark"]) {
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page
          .getByRole("button", { name: theme === "light" ? "Light" : "Dark", exact: true })
          .click();
        await page.screenshot({ path: join(evidence, `working-overlay-${theme}.png`) });
      }
    }
    assert.equal((await set("idle")).structuredContent.working, false);
    await status.waitFor({ state: "hidden" });
    // Page changes replace iframe elements, but activity alone never changes their source URL.
    assert.ok(await preview.getAttribute("src"));
    assert.equal((await call("get_context")).structuredContent.revision, revision);
    await picker.click();
    await page.getByRole("button", { name: initial.pages[0].name, exact: true }).click();
    await call("update_artboard", {
      expectedRevision: revision++,
      commandId: randomUUID(),
      arguments: { artboardId, patch: { html: "<h1>Updated ideas</h1>" } },
    });
    await page.getByRole("button", { name: "Pages, current page Work", exact: true }).waitFor();
    await status.waitFor();
    await page
      .frameLocator('iframe[title="Target"]')
      .getByRole("heading", { name: "Updated ideas" })
      .waitFor();
    assert.equal(await originalFrame.locator("[data-testid=edge-runner]").count(), 0);
    await status.waitFor({ state: "hidden" });
    // A capture can show progress in chrome without contaminating the artboard PNG.
    const capture = await call("capture_artboard", { artboardId, revision });
    assert.deepEqual(capture.structuredContent.unresolved, []);
    assert.equal(capture.structuredContent.width, 360);
    assert.equal(capture.structuredContent.height, 300);
    const image = capture.content.find((item) => item.type === "image");
    const center = await app.evaluate(({ nativeImage }, data) => {
      const png = nativeImage.createFromBuffer(Buffer.from(data, "base64"));
      const offset = (150 * 360 + 180) * 4;
      return Array.from(png.toBitmap().subarray(offset, offset + 3));
    }, image.data);
    assert.deepEqual(center, [255, 255, 255]);
    await documentHandle.dispose();
  },
);
