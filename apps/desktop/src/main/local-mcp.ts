import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const token = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
const settings = z.strictObject({ token, port: z.number().int().min(1).max(65535) });

export async function readLocalMcpSettings(profile: string) {
  const path = join(profile, "local-mcp.json");
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw new Error("Could not open the private local-mcp.json settings file.");
  });
  if (!file) return;
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error("local-mcp.json must be a private file owned by your account (mode 600).");
    const bytes = Buffer.alloc(1025);
    const { bytesRead } = await file.read(bytes);
    if (stat.size > 1024 || bytesRead !== stat.size)
      throw new Error("Invalid local-mcp.json settings.");
    try {
      return settings.parse(JSON.parse(bytes.toString("utf8", 0, bytesRead)));
    } catch {
      throw new Error("local-mcp.json must contain a valid bearer token and a fixed port.");
    }
  } finally {
    await file.close();
  }
}

export function environmentMcpSettings(env: NodeJS.ProcessEnv) {
  if (!env.EASY_PROTO_TOKEN) return;
  if (!token.safeParse(env.EASY_PROTO_TOKEN).success)
    throw new Error("Set EASY_PROTO_TOKEN to a random URL-safe token of at least 43 characters.");
  const port = z.coerce
    .number()
    .int()
    .min(0)
    .max(65535)
    .parse(env.EASY_PROTO_PORT ?? "38645");
  return { port, token: env.EASY_PROTO_TOKEN };
}
