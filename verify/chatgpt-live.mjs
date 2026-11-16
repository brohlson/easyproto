import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright";

const scratch = await mkdtemp(join(tmpdir(), "easy-proto-siwc-live-"));
const env = { ...process.env, EASY_PROTO_PROFILE: join(scratch, "profile"), EASY_PROTO_PORT: "0" };
delete env.EASY_PROTO_CODEX_API_KEY;
delete env.EASY_PROTO_CHAT_DEMO;
let app;
let page;

try {
  app = await electron.launch({
    args: [process.cwd(), "--project=" + join(scratch, "ChatGPT sign-in test")],
    env,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10_000);
  const heading = page.frameLocator('iframe[title="Field notes"]').getByRole("heading");
  const original = (await heading.innerText()).replace(/\s+/g, " ").trim();
  const revision = async () =>
    page.evaluate(async () => (await window.easyProto.getScene()).revision);
  const initial = await revision();
  const button = (name) => page.getByRole("button", { name, exact: true });
  await button("Easy Proto Home").click();
  await button("Add agent").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Codex OpenAI/ }).click();
  await dialog.getByLabel("Name").fill("Codex live check");
  await dialog.getByRole("button", { name: "Continue with ChatGPT", exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector(".chatgpt-connect img")?.naturalWidth > 0,
  );
  const evidence = process.env.EASY_PROTO_EVIDENCE;
  if (evidence)
    await page.screenshot({ path: join(evidence, "before-sign-in.png"), animations: "disabled" });
  await app.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    BrowserWindow.getAllWindows()
      .find((window) => window.isVisible())
      ?.focus();
  });
  console.log(
    "The disposable project is ready. Complete Continue with ChatGPT in the app and approve in the browser.",
  );
  const welcome = page.getByRole("button", { name: "Got it", exact: true });
  const accountError = dialog.getByRole("alert");
  await welcome
    .or(accountError)
    .first()
    .waitFor({ timeout: 15 * 60_000 });
  if (!(await welcome.isVisible())) throw new Error(await accountError.first().innerText());
  await welcome.click();
  await page.getByRole("button", { name: /Codex live check Codex Connected/ }).waitFor();
  await button("ChatGPT sign-in test").click();
  await button("Chat").click();
  const dock = page.getByRole("region", { name: "Chat", exact: true });
  await dock.getByRole("button", { name: "Agent: Choose an agent", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Codex live check", exact: true }).click();
  console.log("ChatGPT plan was enabled. Starting one synthetic headline turn.");
  await page
    .locator(".react-flow__node")
    .filter({
      has: page.getByRole("button", { name: "Rename artboard Field notes", exact: true }),
    })
    .click({ position: { x: 32, y: 32 } });
  await dock.getByRole("button", { name: "Attach Field notes", exact: true }).click();
  await dock
    .getByRole("textbox", { name: "Message" })
    .fill('Replace the headline with exactly "A quieter morning."');
  await dock.getByRole("button", { name: "Send", exact: true }).click();
  const proposal = dock.getByRole("button", { name: "Apply edit", exact: true });
  await proposal.or(dock.getByRole("alert")).first().waitFor({ timeout: 55_000 });
  if (!(await proposal.isVisible()))
    throw new Error(await dock.getByRole("alert").first().innerText());
  assert.match(
    await dock.getByRole("region", { name: "Proposed headline change" }).innerText(),
    /A quieter morning[.]/,
  );
  assert.equal(await revision(), initial);
  assert.equal((await heading.innerText()).replace(/\s+/g, " ").trim(), original);
  await proposal.click();
  await heading.filter({ hasText: "A quieter morning." }).waitFor();
  assert.equal(await revision(), initial + 1);
  await dock.getByRole("button", { name: "Undo edit", exact: true }).click();
  await heading.filter({ hasText: /Make room/ }).waitFor();
  assert.equal((await heading.innerText()).replace(/\s+/g, " ").trim(), original);
  assert.equal(await revision(), initial + 2);
  const result = {
    environment: process.platform + " " + process.arch,
    liveChatGPTPlan: true,
    initial,
    applied: initial + 1,
    undone: initial + 2,
  };
  if (evidence)
    await writeFile(join(evidence, "live-turn.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  if (page) {
    const home = page.getByRole("button", { name: "Easy Proto Home", exact: true });
    if (await home.isVisible().catch(() => false)) await home.click().catch(() => undefined);
    const connected = page.getByRole("button", { name: /Codex live check Codex Connected/ });
    if (await connected.isVisible().catch(() => false)) {
      await connected.click().catch(() => undefined);
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: "Disconnect", exact: true })
        .click()
        .catch(() => undefined);
      await dialog
        .getByRole("button", { name: "Reconnect", exact: true })
        .waitFor({ timeout: 25_000 })
        .catch(() => undefined);
    }
  }
  await app?.close();
  await rm(scratch, { recursive: true, force: true });
}
