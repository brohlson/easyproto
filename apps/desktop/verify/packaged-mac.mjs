import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { _electron as electron } from "playwright";

const bundle = process.argv[2]
  ? resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2])
  : fileURLToPath(
      new URL("../dist/package/Easy Proto-darwin-arm64/Easy Proto.app", import.meta.url),
    );
const executablePath = join(bundle, "Contents", "MacOS", "Easy Proto");
const iconFile = execFileSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleIconFile", join(bundle, "Contents", "Info.plist")],
  { encoding: "utf8" },
).trim();
const [packagedIcon, sourceIcon] = await Promise.all([
  readFile(join(bundle, "Contents", "Resources", iconFile)),
  readFile(new URL("../assets/app-icon.icns", import.meta.url)),
]);
assert.ok(packagedIcon.equals(sourceIcon), "The macOS bundle must contain the Fold icon");
const scratch = await mkdtemp(join(tmpdir(), "easy-proto-packaged-check-"));
const name = "iPhone mockup check";
const project = join(scratch, name);
const evidence = process.env.EASY_PROTO_EVIDENCE;
const title = "iPhone Reading List";
const heading = "Read later";
const width = 402;
const height = 874;
const html =
  "<main><p>LIBRARY</p><h1>Read later</h1><article>Field notes for a quieter week</article></main>";
const css =
  "body{margin:0;padding:72px 24px;background:#e8f3ec;color:#153528;font:18px system-ui}article{border-top:1px solid #769285;padding-top:24px}";
let app;
let client;

async function open(first) {
  const token = randomBytes(32).toString("base64url");
  const portProbe = createServer();
  portProbe.listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const { port } = portProbe.address();
  await new Promise((resolve) => portProbe.close(resolve));
  const env = {
    ...process.env,
    EASY_PROTO_PROFILE: join(scratch, "profile"),
    EASY_PROTO_PORT: String(port),
    EASY_PROTO_TOKEN: token,
  };
  delete env.EASY_PROTO_CODEX_API_KEY;
  app = await electron.launch({
    executablePath,
    args: first ? ["--project=" + project] : [],
    cwd: scratch,
    env,
  });
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  const page = await app.firstWindow();
  await page.getByRole("button", { name: first ? "Easy Proto Home" : name, exact: true }).waitFor();
  client = new Client({ name: "packaged-mac-verification", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer " + token } },
    }),
  );
  return page;
}

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
  return result;
}

async function verifyViewport(page) {
  const preview = page.frameLocator(`iframe[title="${title}"]`);
  await preview.getByRole("heading", { name: heading, exact: true }).waitFor();
  const actual = await preview
    .locator("body")
    .evaluate((body) => [innerWidth, innerHeight, getComputedStyle(body).backgroundColor]);
  assert.deepEqual(actual, [width, height, "rgb(232, 243, 236)"]);
}

try {
  let page = await open(true);
  const runtime = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    electron: process.versions.electron,
  }));
  const before = (await call("get_context")).structuredContent;
  const { projectId, activationId } = before;
  const receipt = (
    await call("create_artboard", {
      projectId,
      activationId,
      commandId: randomUUID(),
      expectedRevision: before.revision,
      arguments: { name: title, x: 620, y: 0, width, height, html, css },
    })
  ).structuredContent;
  const artboardId = receipt.artboard.id;
  await verifyViewport(page);
  const capture = await call("capture_artboard", {
    projectId,
    activationId,
    artboardId,
    revision: receipt.revision,
  });
  const stamp = capture.structuredContent;
  const png = Buffer.from(capture.content.find(({ type }) => type === "image").data, "base64");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height]);
  assert.deepEqual(stamp.unresolved, []);
  assert.equal(stamp.sourceRevision, receipt.artboard.sourceRevision);

  await client.close();
  client = undefined;
  await app.close();
  app = undefined;
  page = await open(false);
  await page.getByRole("button", { name, exact: true }).click();
  await verifyViewport(page);
  const reopened = (await call("get_context")).structuredContent;
  assert.equal(reopened.projectId, projectId);
  assert.equal(reopened.revision, receipt.revision);
  assert.notEqual(reopened.activationId, activationId);
  const saved = (
    await call("get_artboard", { projectId, activationId: reopened.activationId, artboardId })
  ).structuredContent;
  assert.deepEqual({ html: saved.html, css: saved.css }, { html, css });
  const result = {
    platform: process.platform,
    architecture: process.arch,
    runtime,
    icon: iconFile,
    viewport: [width, height],
    committedRevision: receipt.revision,
    reopenedRevision: reopened.revision,
    capture: stamp,
  };
  if (evidence) {
    await writeFile(join(evidence, "iphone-capture.png"), png);
    await writeFile(join(evidence, "packaged-result.json"), JSON.stringify(result, null, 2) + "\n");
  }
  console.log(JSON.stringify(result));
} finally {
  await client?.close();
  await app?.close();
  await rm(scratch, { recursive: true, force: true });
}
