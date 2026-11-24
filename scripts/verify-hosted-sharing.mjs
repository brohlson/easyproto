import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, chromium, webkit } from "playwright";
import { expect } from "playwright/test";
import { Project } from "../apps/desktop/dist/project.js";
import { png } from "../apps/web/fixtures/png.mjs";

const [origin, secretFile, passwordFile] = process.argv.slice(2);
const evidence = process.env.EASY_PROTO_HOSTED_EVIDENCE;
const executable = process.env.EASY_PROTO_HOSTED_APP;
const focusOnly = process.env.EASY_PROTO_HOSTED_FOCUS_ONLY === "1";
if (evidence) await mkdir(evidence, { recursive: true });
assert.ok(["https://staging.easyproto.app", "https://easyproto.app"].includes(origin));
const { HOSTED_PUBLISH_TOKEN } = JSON.parse(await readFile(secretFile, "utf8"));
assert.match(HOSTED_PUBLISH_TOKEN, /^[\w-]{43}$/);
const desktop = fileURLToPath(new URL("../apps/desktop", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "easy-proto-live-demo-"));
const project = await Project.open(join(directory, "Field Notes"));
const assets = join(project.root, "assets");
await mkdir(assets, { recursive: true });
await writeFile(join(assets, "preview.png"), png(12, 12));
const sample = {
  name: "Field Notes",
  width: 560,
  height: 360,
  html: `<main><header>FIELD NOTES</header><h1>Make room for ideas.</h1><p>Capture observations, review what matters, and choose what to do next.</p><img src="assets/preview.png" alt="Sample swatch"></main>`,
  css: `body { margin: 0; color: rgb(35, 78, 63); background: #f5f2ea; font: 17px system-ui, sans-serif; }
main { box-sizing: border-box; padding: 36px; min-height: 100vh; border: 8px solid #dce7df; }
header { letter-spacing: .15em; font-size: 12px; }
h1 { font-size: clamp(28px, 8vw, 48px); line-height: 1.1; margin: 35px 0 14px; }
p { max-width: 360px; }`,
};
const command = (operation, args) =>
  project.execute({
    projectId: project.snapshot.manifest.projectId,
    commandId: randomUUID(),
    expectedRevision: project.snapshot.manifest.revision,
    operation,
    arguments: args,
  });
const starter = project.snapshot.manifest.artboards[0];
if (starter) await command("update_artboard", { artboardId: starter.id, patch: sample });
else await command("create_artboard", { ...sample, x: 0, y: 0 });
const { page: hidden } = await command("create_page", { name: "Unshared source" });
await command("create_artboard", {
  pageId: hidden.id,
  name: "Unshared board",
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  html: "<h1>Unshared source marker</h1>",
  css: "",
});

let app;
let browser;
let otherBrowser;
let dialog;
try {
  app = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [...(executable ? [] : [desktop]), `--project=${project.root}`],
    cwd: desktop,
    env: {
      ...process.env,
      EASY_PROTO_PROFILE: join(directory, "profile"),
      EASY_PROTO_WEB_HOSTED_ORIGIN: origin,
      EASY_PROTO_WEB_HOSTED_TOKEN: HOSTED_PUBLISH_TOKEN,
    },
  });
  const window = await app.firstWindow();
  window.setDefaultTimeout(15000);
  await window
    .frameLocator('iframe[title="Field Notes"]')
    .getByRole("heading", { name: "Make room for ideas." })
    .waitFor();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await window.getByRole("button", { name: "Export page to web preview…" }).click();
  dialog = window.getByRole("dialog", { name: "Share this page." });
  const publicSync = dialog.getByRole("button", { name: "Sync page" });
  if (focusOnly) {
    await expect(publicSync).toBeEnabled();
    const generate = dialog.getByRole("button", { name: "Generate password" });
    await generate.focus();
    await generate.press("Enter");
    await expect(dialog.getByText("A new password will be generated when you sync.")).toBeVisible();
    await dialog.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(window.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
    console.log("Keyboard generation, Escape and restored Settings focus verified.");
  } else {
    await publicSync.click();
    await dialog.getByRole("textbox", { name: "Preview link" }).waitFor();
    const link = await dialog.getByRole("textbox", { name: "Preview link" }).inputValue();
    assert.equal(new URL(link).origin, origin);
    const api = `${origin}/api/previews/${link.split("/").at(-1)}`;
    const publicPage = await (await fetch(api)).json();
    assert.equal(publicPage.artboards.length, 1);
    assert.equal(publicPage.artboards[0].name, sample.name);

    const generate = dialog.getByRole("button", { name: "Generate password" });
    assert.ok((await generate.boundingBox()).height >= 24);
    await generate.focus();
    await generate.press("Enter");
    if (evidence)
      await dialog.screenshot({ path: join(evidence, "desktop-password-selection.png") });
    await publicSync.click();
    const passwordInput = dialog.getByRole("textbox", { name: "Generated access password" });
    await passwordInput.waitFor();
    const password = await passwordInput.inputValue();
    assert.equal(await dialog.getByRole("textbox", { name: "Preview link" }).inputValue(), link);
    assert.equal((await fetch(publicPage.artboards[0].iframeUrl)).status, 404);
    assert.deepEqual(await (await fetch(api)).json(), {
      kind: "locked-preview",
      id: link.split("/").at(-1),
    });

    async function openPreview(engine, incorrectFirst) {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        await page.goto(link);
        await page.getByRole("heading", { name: "Password required" }).waitFor();
        assert.equal(await page.locator("iframe").count(), 0);
        if (evidence && incorrectFirst) {
          await page.emulateMedia({ colorScheme: "dark" });
          await page.screenshot({ path: join(evidence, "guest-locked-dark.png") });
          await page.setViewportSize({ width: 390, height: 650 });
          await page.emulateMedia({ colorScheme: "light" });
          await page.screenshot({ path: join(evidence, "guest-locked-mobile-light.png") });
        }
        const input = page.getByLabel("Password", { exact: true });
        const button = page.getByRole("button", { name: "Unlock preview" });
        if (incorrectFirst) {
          await input.fill("incorrect");
          await button.click();
          await page.getByRole("alert").getByText("Incorrect password.").waitFor();
        }
        await input.fill(password);
        await button.click();
        const iframe = page.locator('iframe[title="Field Notes"]');
        const frame = iframe.contentFrame();
        await frame.getByRole("heading", { name: "Make room for ideas." }).waitFor();
        assert.equal(await iframe.getAttribute("sandbox"), "");
        await expect(frame.locator("body")).toHaveCSS("color", "rgb(35, 78, 63)", {
          timeout: 10000,
        });
        await expect(frame.getByRole("img", { name: "Sample swatch" })).toHaveJSProperty(
          "naturalWidth",
          12,
        );
        if (evidence && incorrectFirst) {
          assert.equal(
            await page.getByText("Read-only preview", { exact: true }).isVisible(),
            false,
          );
          await page.screenshot({ path: join(evidence, "guest-artboard.png") });
          await page.emulateMedia({ colorScheme: "dark" });
          await page.screenshot({ path: join(evidence, "guest-artboard-mobile-dark.png") });
        }
        const frameUrl = await iframe.getAttribute("src");
        const artifact = new URL(frameUrl);
        assert.notEqual(artifact.origin, origin);
        assert.equal((await fetch(new URL(artifact.pathname, origin))).status, 404);
        assert.equal((await fetch(new URL("board.css", artifact), { method: "HEAD" })).status, 200);
        assert.match(
          (await fetch(artifact)).headers.get("content-security-policy"),
          /sandbox;.*frame-ancestors/,
        );
        return browser;
      } catch (failure) {
        await browser.close();
        throw failure;
      }
    }
    browser = await openPreview(chromium, true);
    otherBrowser = await openPreview(webkit, false);
    console.log(
      "The published HTML, CSS and image rendered in both browsers after password unlock.",
    );
    await dialog.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(window.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
    if (passwordFile) await writeFile(passwordFile, password + "\n", { flag: "wx", mode: 0o600 });
    console.log(
      JSON.stringify({
        link,
        artboards: 1,
        browsers: ["Chromium", "WebKit"],
        passwordProtected: true,
        packaged: Boolean(executable),
      }),
    );
  }
} catch (failure) {
  const detail = await dialog
    ?.getByRole("alert")
    .allTextContents()
    .catch(() => []);
  if (detail?.length) console.error(detail.join("\n"));
  throw failure;
} finally {
  await Promise.allSettled([app?.close(), browser?.close(), otherBrowser?.close()]);
  await rm(directory, { recursive: true, force: true });
}
