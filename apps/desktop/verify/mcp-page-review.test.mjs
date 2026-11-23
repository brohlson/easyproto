import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Project } from "../dist/project.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { _electron as electron } from "playwright";

test("MCP creates a page and reviews ten ordered variants at one revision", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "easy-proto-page-review-"));
  let app;
  const client = new Client({ name: "page-review", version: "1" });
  t.after(async () => {
    await client.close();
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });
  await Project.open(join(root, "Mockups"));
  const reserve = createServer().listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const { port } = reserve.address();
  await new Promise((resolve) => reserve.close(resolve));
  const token = randomBytes(32).toString("base64url");
  app = await electron.launch({
    args: [process.cwd(), "--project=" + join(root, "Mockups")],
    env: {
      ...process.env,
      EASY_PROTO_PORT: String(port),
      EASY_PROTO_TOKEN: token,
      EASY_PROTO_PROFILE: join(root, "profile"),
    },
  });
  const page = await app.firstWindow();
  const picker = page.getByRole("button", { name: /^Pages, current page / });
  await picker.waitFor();
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer " + token } },
    }),
  );
  const context = async () => (await client.callTool({ name: "get_context" })).structuredContent;
  const initial = await context();
  const { projectId, activationId } = initial;
  const call = (name, args) =>
    client.callTool({ name, arguments: { projectId, activationId, ...args } });
  let revision = initial.revision;
  async function commit(name, args) {
    const envelope = { expectedRevision: revision, commandId: randomUUID(), arguments: args };
    const response = await call(name, envelope);
    assert.equal(response.isError, undefined, JSON.stringify(response.structuredContent));
    if (name === "create_page")
      assert.deepEqual((await call(name, envelope)).structuredContent, response.structuredContent);
    assert.equal(response.structuredContent.revision, ++revision);
    return response.structuredContent;
  }
  const { page: created } = await commit("create_page", { name: "Studies" });
  await commit("rename_page", { pageId: created.id, name: "Logos" });
  assert.equal((await context()).activePageId, initial.defaultPageId);
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const dark = i % 2 === 1;
    const name = `Rank ${1 + Math.floor(i / 2)} · ${dark ? "Dark" : "Light"}`;
    const board = await commit("create_artboard", {
      pageId: created.id,
      name,
      x: i * 220,
      y: 0,
      width: 200,
      height: 240,
      html: "<h1>" + name + "</h1>",
      css:
        `body{background:${dark ? "#123456" : "#fedcba"};color:${dark ? "white" : "black"};font:14px system-ui}` +
        (i === 5
          ? "@font-face{font-family:Inter;src:url(assets/missing-inter.woff2)} h1{font-family:Inter}"
          : ""),
    });
    ids.push(board.artboard.id);
  }
  await picker.click();
  await page.getByRole("button", { name: "Logos", exact: true }).click();
  assert.equal((await context()).activePageId, created.id);
  const args = { revision, artboardIds: ids.toReversed() };
  const review = await call("capture_artboards", args);
  assert.equal(review.isError, undefined, JSON.stringify(review.structuredContent));
  const { warnings, captures, status } = review.structuredContent;
  assert.equal(status, "captured_with_warnings");
  assert.deepEqual(
    warnings.map((w) => w.artboardId),
    [ids[5]],
  );
  assert.match(warnings[0].unresolved.join(" "), /Font could not load: Inter/);
  assert.deepEqual(
    captures.map((c) => c.artboardId),
    args.artboardIds,
  );
  assert.ok(captures.every((c) => c.revision === revision));
  assert.equal(review.content.length, 2);
  const sheet = review.content[1].data;
  if (process.env.EASY_PROTO_EVIDENCE)
    await writeFile(
      join(process.env.EASY_PROTO_EVIDENCE, "page-review.png"),
      Buffer.from(sheet, "base64"),
    );
  const pixels = await app.evaluate(({ nativeImage }, sheet) => {
    const image = nativeImage.createFromBuffer(Buffer.from(sheet, "base64"));
    const { width, height } = image.getSize();
    const bytes = image.toBitmap();
    const colors = Array.from({ length: 10 }, (_, index) => {
      const x = (index % 4) * 240 + 120;
      const y = Math.floor(index / 4) * 216 + 90;
      const offset = (y * width + x) * 4;
      return Array.from(bytes.subarray(offset, offset + 3)).reverse();
    });
    return { width, height, colors };
  }, sheet);
  assert.deepEqual(pixels, {
    width: 960,
    height: 648,
    colors: ids.map((_, i) => (i % 2 === 0 ? [18, 52, 86] : [254, 220, 186])),
  });
  const originals = await call("capture_artboards", {
    revision,
    artboardIds: [ids[0]],
    includeFullResolution: true,
  });
  assert.equal(originals.structuredContent.status, "captured");
  const png = Buffer.from(originals.content[2].data, "base64");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [200, 240]);
  for (const [patch, code] of [
    [{ revision: revision - 1 }, "REVISION_CONFLICT"],
    [{ artboardIds: [ids[0], randomUUID()] }, "ARTBOARD_NOT_FOUND"],
    [{ activationId: randomUUID() }, "PROJECT_SCOPE"],
  ]) {
    assert.equal(
      (await call("capture_artboards", { ...args, ...patch })).structuredContent.code,
      code,
    );
  }
  assert.equal(
    (await call("capture_artboards", { ...args, artboardIds: [ids[0], ids[0]] })).isError,
    true,
  );
  assert.equal((await context()).revision, revision);
});
