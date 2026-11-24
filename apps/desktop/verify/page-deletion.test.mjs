import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { _electron as electron } from "playwright";
import { Project } from "../dist/project.js";

for (const storage of ["folder", "sqlite"]) {
  test(
    `Pages picker deletes, confirms and restores pages through Undo in ${storage}`,
    { timeout: 35_000 },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "easy-proto-page-delete-"));
      const folder = join(root, "Pages");
      const seed = await Project.open(folder);
      const { projectId } = seed.snapshot.manifest;
      const execute = (operation, args) =>
        seed.execute({
          projectId,
          commandId: randomUUID(),
          expectedRevision: seed.snapshot.manifest.revision,
          operation,
          arguments: args,
        });
      const explore = (await execute("create_page", { name: "Explorations" })).page;
      const empty = (await execute("create_page", { name: "Empty" })).page;
      const original = seed.pageLayout;
      for (const name of ["First concept", "Second concept"])
        await execute("create_artboard", {
          name,
          pageId: explore.id,
          width: 200,
          height: 150,
          x: 20,
          y: 20,
          html: "<h1>" + name + "</h1>",
          css: "body{background:#ddd}",
        });
      const path = storage === "sqlite" ? join(root, "Pages.easyproto") : folder;
      if (storage === "sqlite") await Project.importFolder(folder, path);
      const originalSources = seed.snapshot.sources;
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
      const client = new Client({ name: "page-deletion-test", version: "1.0.0" });
      t.after(async () => {
        await client.close();
        await app?.close();
        await rm(root, { recursive: true, force: true });
      });
      app = await electron.launch({ args: [process.cwd(), "--project=" + path], env });
      const page = await app.firstWindow();
      if (storage === "sqlite")
        await app.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0].setSize(660, 480);
        });
      page.setDefaultTimeout(5000);
      const scene = () => page.evaluate(() => window.easyProto.getScene());
      const button = (name) => page.getByRole("button", { name, exact: true });
      const menu = page.getByRole("group", { name: "Pages", exact: true });
      const picker = page.getByRole("button", { name: /^Pages, current page / });
      const dialog = page.getByRole("dialog");
      await picker.waitFor();
      if (storage === "sqlite") {
        await button("Settings").click();
        await button("Dark").click();
        await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      }
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: { Authorization: "Bearer " + token } },
        }),
      );
      const context = (await client.callTool({ name: "get_context" })).structuredContent;
      const { activationId } = context;
      async function openMenu() {
        await page.waitForFunction(
          () => !document.querySelector("[data-testid=page-picker-trigger]")?.disabled,
        );
        if (!(await menu.isVisible())) await picker.click();
      }
      async function openActions(name) {
        await openMenu();
        await button(`Page settings for ${name}`).click();
        const actions = page.getByRole("menu", { name: `Page actions for ${name}`, exact: true });
        await actions.waitFor();
        assert.equal(await menu.isVisible(), true);
        return actions;
      }
      async function waitRevision(revision) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if ((await scene()).revision === revision && (await picker.isEnabled())) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.fail(`Page operation did not reach revision ${revision}`);
      }
      async function undo() {
        const previous = (await scene()).revision;
        await page.keyboard.press("Meta+z");
        await waitRevision(previous + 1);
      }
      const focused = (locator) =>
        locator.evaluate((element) => document.activeElement === element);
      const pickerFocused = () =>
        page.waitForFunction(() =>
          document.activeElement?.matches("[data-testid=page-picker-trigger]"),
        );
      const initial = (await scene()).revision;
      await openMenu();
      await (
        await openActions("Empty")
      )
        .getByRole("menuitem", { name: "Delete", exact: true })
        .click();
      await waitRevision(initial + 1);
      assert.equal(await dialog.isVisible(), false);
      await pickerFocused();
      await undo();
      assert.equal((await scene()).revision, initial + 2, "Undo should commit a restored page");
      await openMenu();
      await button("Page 1").click();
      await openMenu();
      await button("Page settings for Explorations").focus();
      await page.keyboard.press("ArrowRight");
      const actions = page.getByRole("menu", {
        name: "Page actions for Explorations",
        exact: true,
      });
      await actions.waitFor();
      assert.equal(
        await actions
          .getByRole("menuitem", { name: "Rename" })
          .evaluate((element) => document.activeElement === element),
        true,
      );
      await page.keyboard.press("ArrowLeft");
      await actions.waitFor({ state: "hidden" });
      assert.equal(await menu.isVisible(), true);
      assert.equal(
        await button("Page settings for Explorations").evaluate(
          (element) => document.activeElement === element,
        ),
        true,
      );
      await page.keyboard.press("ArrowRight");
      await actions.waitFor();
      await page.keyboard.press("Escape");
      await actions.waitFor({ state: "hidden" });
      assert.equal(await menu.isVisible(), true);
      assert.equal(await focused(button("Page settings for Explorations")), true);
      await page.keyboard.press("ArrowRight");
      await actions.waitFor();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await dialog.waitFor();
      await dialog.getByText("This also deletes its 2 artboards.").waitFor();
      assert.equal(
        await dialog
          .getByRole("button", { name: "Cancel" })
          .evaluate((element) => document.activeElement === element),
        true,
      );
      const evidence = process.env.EASY_PROTO_EVIDENCE;
      if (evidence)
        await page.screenshot({ path: join(evidence, "page-delete-confirm-" + storage + ".png") });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.equal((await scene()).revision, initial + 2);
      assert.ok(
        await page.evaluate(() =>
          document.activeElement?.matches(
            "[data-testid=page-picker-trigger], [data-testid=page-icon-button]",
          ),
        ),
      );
      await openMenu();
      const leased = (await scene()).artboards.find(({ pageId }) => pageId === explore.id);
      const activity = await client.callTool({
        name: "set_artboard_activity",
        arguments: {
          projectId,
          activationId,
          artboardId: leased.id,
          activityId: randomUUID(),
          status: "working",
        },
      });
      assert.equal(activity.isError, undefined);
      assert.equal((await scene()).artboards.find(({ id }) => id === leased.id).agentWorking, true);
      await (
        await openActions("Explorations")
      )
        .getByRole("menuitem", { name: "Delete", exact: true })
        .click();
      await dialog.getByRole("button", { name: "Delete page", exact: true }).click();
      await waitRevision(initial + 3);
      await pickerFocused();
      assert.equal(
        (await scene()).artboards.some(({ pageId }) => pageId === explore.id),
        false,
      );
      await page.frameLocator('iframe[title="Field notes"]').getByRole("heading").waitFor();
      await undo();
      await page.getByRole("button", { name: "Pages, current page Explorations" }).waitFor();
      assert.deepEqual((await Project.open(path)).snapshot.sources, originalSources);
      assert.equal(
        Boolean((await scene()).artboards.find(({ id }) => id === leased.id).agentWorking),
        false,
      );
      await page.frameLocator('iframe[title="First concept"]').getByRole("heading").waitFor();
      await page.keyboard.press("Meta+Shift+z");
      await waitRevision(initial + 5);
      assert.equal(
        (await scene()).pages.some(({ id }) => id === explore.id),
        false,
      );
      await undo();

      await openMenu();
      await (
        await openActions("Explorations")
      )
        .getByRole("menuitem", { name: "Delete", exact: true })
        .click();
      const beforeConflict = await scene();
      const changed = await client.callTool({
        name: "update_artboard",
        arguments: {
          projectId,
          activationId,
          commandId: randomUUID(),
          expectedRevision: beforeConflict.revision,
          arguments: { artboardId: beforeConflict.artboards[0].id, patch: { x: 25 } },
        },
      });
      assert.equal(changed.isError, undefined);
      await waitRevision(beforeConflict.revision + 1);
      await dialog.getByRole("button", { name: "Delete page", exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      assert.equal(
        (await scene()).pages.some(({ id }) => id === explore.id),
        true,
      );
      await dialog.getByRole("button", { name: "Cancel" }).click();

      await openMenu();
      await (
        await openActions("Page 1")
      )
        .getByRole("menuitem", { name: "Delete", exact: true })
        .click();
      const beforeDefault = (await scene()).revision;
      await dialog.getByRole("button", { name: "Delete page", exact: true }).click();
      await waitRevision(beforeDefault + 1);
      assert.equal((await scene()).pages.length, 2);
      assert.equal((await scene()).defaultPageId, explore.id);
      await openMenu();
      await openActions("Empty");
      if (evidence)
        await page.screenshot({ path: join(evidence, "pages-delete-menu-" + storage + ".png") });
      await page.keyboard.press("Escape");
      assert.equal(await menu.isVisible(), true);
      await page.keyboard.press("Escape");
      const beforeMcp = await scene();
      const command = {
        projectId,
        activationId,
        commandId: randomUUID(),
        expectedRevision: beforeMcp.revision,
        arguments: { pageId: empty.id },
      };
      const deleted = await client.callTool({ name: "delete_page", arguments: command });
      assert.equal(deleted.isError, undefined);
      assert.deepEqual(
        (await client.callTool({ name: "delete_page", arguments: command })).structuredContent,
        deleted.structuredContent,
      );
      await waitRevision(beforeMcp.revision + 1);
      await openMenu();
      assert.equal(
        await (
          await openActions("Explorations")
        )
          .getByRole("menuitem", { name: "Delete", exact: true })
          .isDisabled(),
        true,
      );
      const last = await client.callTool({
        name: "delete_page",
        arguments: {
          ...command,
          commandId: randomUUID(),
          expectedRevision: beforeMcp.revision + 1,
          arguments: { pageId: explore.id },
        },
      });
      assert.equal(last.structuredContent.code, "LAST_PAGE");
      const retired = await client.callTool({
        name: "delete_page",
        arguments: {
          ...command,
          activationId: randomUUID(),
        },
      });
      assert.equal(retired.structuredContent.code, "PROJECT_SCOPE");
      await client.close();
      await app.close();
      app = await electron.launch({ args: [process.cwd(), "--project=" + path], env });
      const reopened = await app.firstWindow();
      await reopened
        .getByRole("button", { name: "Pages, current page Explorations", exact: true })
        .waitFor();
      assert.deepEqual((await Project.open(path)).pageLayout, {
        defaultPageId: explore.id,
        pages: [explore],
      });
      assert.deepEqual(
        original.pages.map(({ name }) => name),
        ["Page 1", "Explorations", "Empty"],
      );
    },
  );
}
