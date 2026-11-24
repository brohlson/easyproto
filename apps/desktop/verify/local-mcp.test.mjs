import assert from "node:assert/strict";
import { chmod, link, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { environmentMcpSettings, readLocalMcpSettings } from "../src/main/mcp/settings.ts";

test("saved MCP settings require an opted-in, private, single-link file and a fixed port", async (t) => {
  const profile = await mkdtemp(join(tmpdir(), "easy-proto-settings-"));
  t.after(() => rm(profile, { recursive: true, force: true }));
  const path = join(profile, "local-mcp.json");
  const connection = { token: "x".repeat(48), port: 38646 };
  assert.equal(await readLocalMcpSettings(profile), undefined);
  await writeFile(path, JSON.stringify(connection), { mode: 0o600 });
  assert.deepEqual(await readLocalMcpSettings(profile), connection);
  await chmod(path, 0o644);
  await assert.rejects(readLocalMcpSettings(profile), /private file/);
  await chmod(path, 0o600);
  const other = join(profile, "other");
  await link(path, other);
  await assert.rejects(readLocalMcpSettings(profile), /private file/);
  await unlink(path);
  await symlink(other, path);
  await assert.rejects(readLocalMcpSettings(profile), /Could not open/);
  await unlink(path);
  await writeFile(path, JSON.stringify({ ...connection, port: 0 }), { mode: 0o600 });
  await assert.rejects(readLocalMcpSettings(profile), {
    message: "local-mcp.json must contain a valid bearer token and a fixed port.",
  });
  assert.deepEqual(
    environmentMcpSettings({ EASY_PROTO_TOKEN: connection.token, EASY_PROTO_PORT: "0" }),
    { ...connection, port: 0 },
  );
  assert.equal(environmentMcpSettings({ EASY_PROTO_PORT: "38646" }), undefined);
});
