import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { _electron as electron } from "playwright";
import { Project } from "../dist/project.js";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);

for (const format of ["folder", "sqlite"]) {
  test(
    `Save a Copy from ${format} reopens a portable project with independent edits`,
    { timeout: 40_000 },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "easy-proto-save-copy-"));
      const folder = join(root, "Field notes");
      const seed = await Project.open(folder);
      const {
        projectId,
        artboards: [board],
      } = seed.snapshot.manifest;
      const artboardId = board.id;
      const seedCommand = (operation, args) =>
        seed.execute({
          projectId,
          commandId: randomUUID(),
          expectedRevision: seed.snapshot.manifest.revision,
          operation,
          arguments: args,
        });
      await mkdir(join(folder, "assets"));
      await writeFile(join(folder, "assets", "color.png"), pixel);
      await seedCommand("update_artboard", {
        artboardId,
        patch: {
          html: '<h1>Before the dialog</h1><img src="assets/color.png" alt="" width="40" height="40">',
          css: "body{background:var(--ep-paper);font:18px system-ui}",
        },
      });
      await seedCommand("replace_project_tokens", {
        document: JSON.stringify({
          paper: { $type: "color", $value: { colorSpace: "srgb", components: [0.8, 0.9, 1] } },
        }),
      });
      await seedCommand("create_page", { name: "Exploration" });
      const source = format === "folder" ? folder : join(root, "Field notes.easyproto");
      if (format === "sqlite") await Project.importFolder(folder, source);

      const reserve = createServer();
      reserve.listen(0, "127.0.0.1");
      await once(reserve, "listening");
      const port = reserve.address().port;
      await new Promise((resolve, reject) =>
        reserve.close((error) => (error ? reject(error) : resolve())),
      );
      const token = randomBytes(32).toString("base64url");
      const env = {
        ...process.env,
        EASY_PROTO_PROFILE: join(root, "profile"),
        EASY_PROTO_PORT: String(port),
        EASY_PROTO_TOKEN: token,
      };
      const client = new Client({ name: "save-copy-verification", version: "1.0.0" });
      let app;
      t.after(async () => {
        await client.close();
        await app?.close();
        await rm(root, { recursive: true, force: true });
      });
      app = await electron.launch({ args: [process.cwd(), "--project=" + source], env });
      const page = await app.firstWindow();
      page.setDefaultTimeout(6500);
      const button = (name) => page.getByRole("button", { name, exact: true });
      const settings = button("Settings");
      const save = button("Save a Copy…");
      const toast = page
        .locator("[data-testid=toast]")
        .getByText("Project copy saved", { exact: true });
      const heading = (name) =>
        page
          .frameLocator('iframe[title="Field notes"]')
          .getByRole("heading", { name, exact: true });
      const idle = () =>
        page.waitForFunction(() => !document.querySelector("[data-testid=brand-home]")?.disabled);
      await heading("Before the dialog").waitFor();
      if (format === "sqlite") {
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(660, 480),
        );
      }
      await settings.click();
      await button(format === "sqlite" ? "Dark" : "Light").click();
      const evidence = process.env.EASY_PROTO_EVIDENCE;
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: { Authorization: "Bearer " + token } },
        }),
      );
      async function call(name, args) {
        const result = await client.callTool({ name, arguments: args });
        assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
        return result;
      }
      const context = async () => (await call("get_context")).structuredContent;
      async function capture({ activationId, revision }) {
        const result = await call("capture_artboard", {
          projectId,
          artboardId,
          activationId,
          revision,
        });
        const image = result.content.find(({ type }) => type === "image");
        const pixels = await app.evaluate(({ nativeImage }, encoded) => {
          const bitmap = nativeImage.createFromBuffer(Buffer.from(encoded, "base64")).toBitmap();
          return process
            .getBuiltinModule("crypto")
            .createHash("sha256")
            .update(bitmap)
            .digest("hex");
        }, image.data);
        assert.deepEqual(result.structuredContent.unresolved, []);
        return { pixels, metadata: result.structuredContent };
      }
      async function pickSave() {
        await idle();
        await settings.press("Enter");
        await save.focus();
        await page.keyboard.press("Enter");
      }
      async function stubSave(result) {
        await app.evaluate(({ dialog }, result) => {
          dialog.showSaveDialog = async () => result;
        }, result);
      }
      async function openProject(path, expectedHeading) {
        await app.evaluate(({ dialog }, path) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
        }, path);
        await idle();
        await settings.click();
        await button("Open project…").click();
        await heading(expectedHeading).waitFor();
        await idle();
        return context();
      }

      const active = await context();
      if (evidence) {
        await settings.click();
        await save.focus();
        await page.screenshot({ path: join(evidence, `menu-${format}.png`) });
        await page.keyboard.press("Escape");
        await save.waitFor({ state: "hidden" });
      }
      const canceledPath = join(root, "Canceled.easyproto");
      await stubSave({ canceled: true, filePath: canceledPath });
      await pickSave();
      await idle();
      await assert.rejects(readFile(canceledPath), { code: "ENOENT" });
      assert.equal(await toast.count(), 0);
      assert.equal((await context()).activationId, active.activationId);

      const wrongExtension = join(root, "Wrong extension.txt");
      await stubSave({ canceled: false, filePath: wrongExtension });
      await pickSave();
      await page.getByRole("alert").getByText("Use a filename ending in .easyproto.").waitFor();
      await assert.rejects(readFile(wrongExtension), { code: "ENOENT" });

      const occupied = join(root, "Occupied.easyproto");
      await writeFile(occupied, "Existing file");
      await stubSave({ canceled: false, filePath: occupied });
      await pickSave();
      await page
        .getByRole("alert")
        .getByText(/A file already exists at that location/)
        .waitFor();
      assert.equal(await readFile(occupied, "utf8"), "Existing file");
      assert.equal((await context()).revision, active.revision);

      // The renderer requests a save dialog and sends no path. Keep the sheet pending while MCP edits.
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = (_owner, options) =>
          new Promise((resolve) => {
            globalThis.copyDialog = { options, resolve };
          });
      });
      await idle();
      await settings.click();
      await save.click();
      await page.waitForFunction(
        () => document.querySelector("[data-testid=brand-home]")?.disabled,
      );
      await page.evaluate(() => window.easyProto.goHome());
      assert.equal((await context()).activationId, active.activationId);
      const committedWhileChoosing = {
        projectId,
        commandId: randomUUID(),
        expectedRevision: active.revision,
        arguments: {
          artboardId,
          patch: {
            html: '<h1>Saved from the dialog</h1><img src="assets/color.png" alt="" width="40" height="40">',
          },
        },
      };
      const receipt = await call("update_artboard", {
        ...committedWhileChoosing,
        activationId: active.activationId,
      });
      const pathWithoutExtension = join(root, "Portable copy");
      const dialogOptions = await app.evaluate((_, path) => {
        const { options, resolve } = globalThis.copyDialog;
        resolve({ canceled: false, filePath: path });
        return options;
      }, pathWithoutExtension);
      assert.equal(dialogOptions.title, "Save a Copy");
      assert.match(dialogOptions.defaultPath, /Field notes copy\.easyproto$/);
      await toast.waitFor();
      const saved = await context();
      assert.equal(saved.activationId, active.activationId);
      assert.equal(saved.revision, receipt.structuredContent.revision);
      await heading("Saved from the dialog").waitFor();
      if (evidence) {
        await page.locator('[data-testid=artboard-preview][data-loaded="true"]').waitFor();
        await page.screenshot({
          path: join(evidence, `success-${format}.png`),
          animations: "disabled",
        });
      }
      await stubSave({ canceled: false, filePath: occupied });
      await pickSave();
      const retryError = page.getByRole("alert");
      await retryError.getByText(/A file already exists at that location/).waitFor();
      assert.equal(await toast.count(), 0);
      await retryError.getByRole("button", { name: "Dismiss", exact: true }).click();
      const originalCapture = await capture(saved);

      const movedFolder = join(root, "Elsewhere");
      await mkdir(movedFolder);
      const moved = join(movedFolder, "Portable copy.easyproto");
      await rename(pathWithoutExtension + ".easyproto", moved);
      const original = await Project.open(source);
      const portable = await Project.open(moved);
      assert.deepEqual(portable.snapshot, original.snapshot);
      assert.deepEqual(portable.assets, original.assets);
      const copy = await openProject(moved, "Saved from the dialog");
      assert.equal(copy.projectId, projectId);
      assert.notEqual(copy.activationId, saved.activationId);
      assert.equal(copy.revision, saved.revision);
      const background = await page
        .frameLocator('iframe[title="Field notes"]')
        .locator("body")
        .evaluate((body) => getComputedStyle(body).backgroundColor);
      assert.equal(background, "rgb(204, 230, 255)");
      const copiedCapture = await capture(copy);
      assert.equal(copiedCapture.pixels, originalCapture.pixels);
      assert.equal(copiedCapture.metadata.assetDigest, originalCapture.metadata.assetDigest);
      assert.deepEqual(copiedCapture.metadata.tokens, originalCapture.metadata.tokens);
      const stale = await client.callTool({
        name: "get_artboard",
        arguments: { projectId, artboardId, activationId: saved.activationId },
      });
      assert.equal(stale.structuredContent.code, "PROJECT_SCOPE");
      const replay = await call("update_artboard", {
        ...committedWhileChoosing,
        activationId: copy.activationId,
      });
      assert.deepEqual(replay.structuredContent, receipt.structuredContent);
      assert.equal((await context()).revision, copy.revision);

      async function edit(state, title) {
        await call("update_artboard", {
          projectId,
          activationId: state.activationId,
          commandId: randomUUID(),
          expectedRevision: state.revision,
          arguments: { artboardId, patch: { html: `<h1>${title}</h1>` } },
        });
        await heading(title).waitFor();
      }
      await edit(copy, "Only in the copy");
      const reopenedOriginal = await openProject(source, "Saved from the dialog");
      assert.equal(reopenedOriginal.revision, saved.revision);
      await edit(reopenedOriginal, "Only in the original");
      const reopenedCopy = await openProject(moved, "Only in the copy");
      assert.equal(reopenedCopy.revision, saved.revision + 1);
      assert.equal(
        (await Project.open(source)).snapshot.sources.get(artboardId).html,
        "<h1>Only in the original</h1>",
      );
      if (evidence)
        await writeFile(
          join(evidence, `round-trip-${format}.json`),
          JSON.stringify(
            {
              format,
              savedRevision: saved.revision,
              copyRevision: reopenedCopy.revision,
              viewport: [copiedCapture.metadata.width, copiedCapture.metadata.height],
              pixels: copiedCapture.pixels,
              assetDigest: copiedCapture.metadata.assetDigest,
            },
            null,
            2,
          ) + "\n",
        );
    },
  );
}
