import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test(
  "Electron opens an imported SQLite file, captures matching pixels and reopens an MCP edit",
  {
    timeout: 40_000,
  },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "easy-proto-sqlite-desktop-"));
    const folder = join(root, "Snapshot");
    const database = join(root, "Copy.easyproto");
    const project = await Project.open(folder);
    const { projectId, artboards } = project.snapshot.manifest;
    const artboardId = artboards[0].id;
    await mkdir(join(folder, "assets"));
    await writeFile(join(folder, "assets", "color.png"), pixel);
    await project.execute({
      projectId,
      commandId: randomUUID(),
      expectedRevision: 0,
      operation: "update_artboard",
      arguments: {
        artboardId,
        patch: {
          html: '<main><h1>Folder preview</h1><img src="assets/color.png" alt="" width="40" height="40"></main>',
          css: "html{background:#eee}body{font:18px system-ui}",
        },
      },
    });
    await Project.importFolder(folder, database);
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
    const client = new Client({ name: "sqlite-desktop-verification", version: "1.0.0" });
    let app;
    t.after(async () => {
      await client.close();
      await app?.close();
      await rm(root, { recursive: true, force: true });
    });
    app = await electron.launch({ args: [process.cwd(), "--project=" + folder], env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(6500);
    const heading = page.frameLocator('iframe[title="Field notes"]').getByRole("heading");
    await heading.filter({ hasText: "Folder preview" }).waitFor();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: "Bearer " + token } },
      }),
    );
    async function capture() {
      const { structuredContent: context } = await client.callTool({ name: "get_context" });
      const { activationId, revision } = context;
      const result = await client.callTool({
        name: "capture_artboard",
        arguments: { projectId, activationId, artboardId, revision },
      });
      assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
      const image = result.content.find(({ type }) => type === "image");
      const pixels = await app.evaluate(({ nativeImage }, encoded) => {
        const bytes = nativeImage.createFromBuffer(Buffer.from(encoded, "base64")).toBitmap();
        return process.getBuiltinModule("crypto").createHash("sha256").update(bytes).digest("hex");
      }, image.data);
      return {
        activationId,
        metadata: result.structuredContent,
        pixels,
        png: Buffer.from(image.data, "base64"),
      };
    }

    const before = await capture();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, database);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Open project…", exact: true }).click();
    await page.waitForFunction(async () => (await window.easyProto.getScene()).generation > 0);
    const copied = await capture();
    assert.notEqual(copied.activationId, before.activationId);
    assert.equal(copied.pixels, before.pixels);
    for (const key of [
      "projectId",
      "revision",
      "artboardId",
      "sourceRevision",
      "sourceDigest",
      "assetDigest",
      "width",
      "height",
      "tokens",
      "chromium",
    ])
      assert.deepEqual(copied.metadata[key], before.metadata[key]);
    assert.deepEqual(copied.metadata.unresolved, []);
    const rejected = await client.callTool({
      name: "get_artboard",
      arguments: { projectId, activationId: before.activationId, artboardId },
    });
    assert.equal(rejected.isError, true);
    const changed = await client.callTool({
      name: "update_artboard",
      arguments: {
        projectId,
        activationId: copied.activationId,
        commandId: randomUUID(),
        expectedRevision: copied.metadata.revision,
        arguments: { artboardId, patch: { html: "<h1>SQLite edit</h1>" } },
      },
    });
    assert.equal(changed.isError, undefined);
    await heading.filter({ hasText: "SQLite edit" }).waitFor();
    await client.close();
    await app.close();
    app = await electron.launch({ args: [process.cwd(), "--project=" + database], env });
    const reopened = await app.firstWindow();
    await reopened
      .frameLocator('iframe[title="Field notes"]')
      .getByRole("heading", { name: "SQLite edit" })
      .waitFor();
    assert.equal(
      await reopened.evaluate(async () => (await window.easyProto.getScene()).revision),
      changed.structuredContent.revision,
    );
    assert.equal((await Project.open(folder)).snapshot.manifest.revision, 1);

    const evidence = process.env.EASY_PROTO_EVIDENCE;
    if (evidence) {
      await writeFile(join(evidence, "sqlite-folder.png"), before.png);
      await writeFile(join(evidence, "sqlite-file.png"), copied.png);
      await writeFile(
        join(evidence, "sqlite-capture.json"),
        JSON.stringify(
          {
            revision: copied.metadata.revision,
            reopenedRevision: changed.structuredContent.revision,
            viewport: [copied.metadata.width, copied.metadata.height],
            sourceDigest: copied.metadata.sourceDigest,
            assetDigest: copied.metadata.assetDigest,
            pixels: copied.pixels,
            unresolved: copied.metadata.unresolved,
            chromium: copied.metadata.chromium,
          },
          null,
          2,
        ) + "\n",
      );
    }
  },
);
