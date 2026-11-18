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
  const login = button("Log in with ChatGPT");
  await login.waitFor();
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
    "The disposable project is ready. Click Log in with ChatGPT and approve in the browser.",
  );
  const connected = button("Codex Connected");
  const accountError = page.getByRole("region", { name: "Agents" }).getByRole("alert");
  await connected
    .or(accountError)
    .first()
    .waitFor({ timeout: 15 * 60_000 });
  if (!(await connected.isVisible())) throw new Error(await accountError.first().innerText());
  await button("ChatGPT sign-in test").click();
  await button("Chat").click();
  const dock = page.getByRole("region", { name: "Chat", exact: true });
  await dock.getByRole("button", { name: "Agent: Codex", exact: true }).waitFor();
  console.log("ChatGPT plan was enabled. Starting one project turn.");
  await dock
    .getByRole("textbox", { name: "Message" })
    .fill('Create a page named exactly "Explorations".');
  await dock.getByRole("button", { name: "Send", exact: true }).click();
  const proposal = dock.getByRole("button", { name: "Apply change", exact: true });
  await proposal.or(dock.getByRole("alert")).first().waitFor({ timeout: 100_000 });
  if (!(await proposal.isVisible()))
    throw new Error(await dock.getByRole("alert").first().innerText());
  assert.match(
    await dock.getByRole("region", { name: "Proposed project change" }).innerText(),
    /Create page “Explorations”/,
  );
  assert.equal(await revision(), initial);
  assert.equal((await heading.innerText()).replace(/\s+/g, " ").trim(), original);
  await proposal.click();
  const scene = () => page.evaluate(() => window.easyProto.getScene());
  await dock.getByRole("button", { name: "Undo edit", exact: true }).waitFor();
  assert.equal(await revision(), initial + 1);
  assert.equal(
    (await scene()).pages.some(({ name }) => name === "Explorations"),
    true,
  );
  await dock.getByRole("button", { name: "Undo edit", exact: true }).click();
  await dock.getByText("Edit undone.").waitFor();
  assert.equal((await heading.innerText()).replace(/\s+/g, " ").trim(), original);
  assert.equal(await revision(), initial + 2);
  assert.equal(
    (await scene()).pages.some(({ name }) => name === "Explorations"),
    false,
  );
  const result = {
    environment: process.platform + " " + process.arch,
    liveChatGPTPlan: true,
    operation: "create_page",
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
    const connected = page.getByRole("button", { name: "Codex Connected", exact: true });
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
