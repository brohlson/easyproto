import { readFile, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const token = process.env.EASY_PROTO_TOKEN;
const port = Number(process.env.EASY_PROTO_PORT ?? "38645");
if (!token || !Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Set EASY_PROTO_TOKEN and the port of the running Easy Proto app.");
const output = new URL("../src/renderer/design.tokens.json", import.meta.url);
const projectIds = new Set();
for (const path of ["EasyProtoMocks", ".workspace/EasyProtoMocks"]) {
  const pointer = new URL(`../../../mocks/${path}/project.json`, import.meta.url);
  const contents = await readFile(pointer, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (contents) projectIds.add(JSON.parse(contents).projectId);
}
const client = new Client({ name: "easy-proto-design-token-sync", version: "1.0.0" });
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const context = await client.callTool({ name: "get_context" });
  const { projectId, activationId } = context.structuredContent ?? {};
  if (context.isError || !projectIds.has(projectId))
    throw new Error("Open the EasyProtoMocks project in Easy Proto.");
  const saved = await client.callTool({
    name: "get_tokens",
    arguments: { projectId, activationId },
  });
  if (saved.isError || typeof saved.structuredContent?.document !== "string")
    throw new Error("Easy Proto could not read the committed design tokens.");
  const { desktop } = JSON.parse(saved.structuredContent.document);
  if (!desktop || typeof desktop !== "object" || Array.isArray(desktop))
    throw new Error("EasyProtoMocks has no desktop token group.");
  await writeFile(output, JSON.stringify({ desktop }, null, 2) + "\n");
  console.log(
    `Synced desktop design tokens from EasyProtoMocks revision ${saved.structuredContent.revision}.`,
  );
} finally {
  await client.close();
}
