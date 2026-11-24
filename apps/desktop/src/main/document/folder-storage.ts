import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { id, manifestSchema, projectName, revision, schemaVersion } from "../../shared/model";
import { tokenByteLimit } from "../../shared/token-types";
import { validateSnapshot, type Asset, type Snapshot } from "./snapshot";

const assetTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".avif", "image/avif"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
]);
const pointerSchema = z.strictObject({
  schemaVersion,
  projectId: id,
  revision,
  snapshot: id,
});
export const managed = ".easy-proto";
const tokenDocument = "design.tokens.json";
const tokenStylesheet = "tokens.css";
export const projectLabel = z.strictObject({ name: projectName });
export const prepareBytes = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export async function readRegular(path: string, max: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max) {
      throw new Error("Expected a regular, single-link project file within the size limit.");
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("File changed while reading.");
      offset += bytesRead;
    }
    if ((await file.stat()).size !== stat.size) throw new Error("File changed while reading.");
    return bytes;
  } finally {
    await file.close();
  }
}

export async function requireDirectory(path: string) {
  if (!(await lstat(path)).isDirectory()) throw new Error("Expected a real directory.");
}

function assetSegment(name: string) {
  // Control characters are excluded from project asset names.
  // oxlint-disable-next-line no-control-regex
  return Boolean(name) && !name.startsWith(".") && !/[\\\u0000-\u001f]/.test(name);
}

function assetMime(name: string) {
  return assetTypes.get(name.slice(name.lastIndexOf(".")).toLowerCase());
}

export function validateDatabaseAssets(assets: Map<string, Asset>) {
  let total = 0;
  for (const [path, { mime, bytes }] of assets) {
    const segments = path.split("/");
    total += bytes.length;
    if (
      segments.length > 13 ||
      !segments.every(assetSegment) ||
      mime !== assetMime(segments.at(-1)!) ||
      bytes.length > 8 * 1024 * 1024 ||
      total > 32 * 1024 * 1024 ||
      assets.size > 2048
    )
      throw new Error("Invalid project asset data.");
  }
}

export async function readAssets(root: string) {
  const assets = new Map<string, Asset>();
  let total = 0;
  let entries = 0;
  async function walk(segments: string[]) {
    if (segments.length > 12) throw new Error("The assets directory is nested too deeply.");
    const folder = join(root, "assets", ...segments);
    await requireDirectory(folder);
    for (const name of (await readdir(folder)).sort()) {
      if (++entries > 2048) throw new Error("The assets directory contains too many entries.");
      if (!assetSegment(name)) continue;
      const path = join(folder, name);
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) throw new Error("Project assets cannot contain symbolic links.");
      if (entry.isDirectory()) {
        await walk([...segments, name]);
        continue;
      }
      const mime = assetMime(name);
      if (!mime) continue;
      const bytes = await readRegular(path, 8 * 1024 * 1024);
      total += bytes.byteLength;
      if (total > 32 * 1024 * 1024) throw new Error("Project assets exceed 32 MiB.");
      assets.set([...segments, name].join("/"), { bytes, mime });
    }
  }
  try {
    await lstat(join(root, "assets"));
  } catch (error) {
    if (missing(error)) return assets;
    throw error;
  }
  await walk([]);
  return assets;
}

export async function loadFolderSnapshot(root: string): Promise<Snapshot> {
  const pointer = pointerSchema.parse(
    JSON.parse((await readRegular(join(root, "project.json"), 4096)).toString()),
  );
  await requireDirectory(join(root, managed));
  const folder = join(root, managed, pointer.snapshot);
  await requireDirectory(folder);
  const manifest = manifestSchema.parse(
    JSON.parse((await readRegular(join(folder, "manifest.json"), 32 * 1024 * 1024)).toString()),
  );
  if (
    manifest.schemaVersion !== pointer.schemaVersion ||
    manifest.revision !== pointer.revision ||
    manifest.projectId !== pointer.projectId
  ) {
    throw new Error("Project pointer and revision disagree.");
  }
  return validateSnapshot(
    manifest,
    async (board) => ({
      html: (await readRegular(join(folder, board.htmlRef), 1024 * 1024)).toString(),
      css: (await readRegular(join(folder, board.cssRef), 512 * 1024)).toString(),
    }),
    async () => ({
      document: (await readRegular(join(folder, tokenDocument), tokenByteLimit)).toString("utf8"),
      css: (await readRegular(join(folder, tokenStylesheet), tokenByteLimit)).toString("utf8"),
    }),
  );
}

export async function readFolderName(root: string) {
  try {
    const bytes = await readRegular(join(root, managed, "name.json"), 4096);
    return projectLabel.parse(JSON.parse(bytes.toString())).name;
  } catch (error) {
    if (!missing(error)) throw error;
    return basename(root);
  }
}

export type CommitPhase = "snapshotWritten" | "pointerPublished";

export async function publishFolderSnapshot(
  root: string,
  snapshot: Snapshot,
  onPhase?: (phase: CommitPhase) => void,
) {
  await requireDirectory(join(root, managed));
  const key = randomUUID();
  const folder = join(root, managed, key);
  const pending = join(root, `.project-${key}.tmp`);
  const { manifest, sources, tokens } = snapshot;
  const { schemaVersion, projectId, revision } = manifest;
  const serialized = prepareBytes(manifest);
  if (Buffer.byteLength(serialized) > 32 * 1024 * 1024)
    throw new Error("Project history capacity reached.");
  await mkdir(folder);
  try {
    if (tokens) {
      await writeFile(join(folder, tokenDocument), tokens.document, { flag: "wx", flush: true });
      await writeFile(join(folder, tokenStylesheet), tokens.css, { flag: "wx", flush: true });
    }
    for (const board of manifest.artboards) {
      const data = sources.get(board.id)!;
      await writeFile(join(folder, board.htmlRef), data.html, { flag: "wx", flush: true });
      await writeFile(join(folder, board.cssRef), data.css, { flag: "wx", flush: true });
    }
    await writeFile(join(folder, "manifest.json"), serialized, { flag: "wx", flush: true });
    await writeFile(pending, prepareBytes({ schemaVersion, projectId, revision, snapshot: key }), {
      flag: "wx",
      flush: true,
    });
    onPhase?.("snapshotWritten");
    await rename(pending, join(root, "project.json"));
  } catch (error) {
    await Promise.allSettled([
      rm(folder, { recursive: true, force: true }),
      rm(pending, { force: true }),
    ]);
    throw error;
  }
}

export async function renameFolderProject(root: string, bytes: string) {
  const folder = join(root, managed);
  const pending = join(folder, `.name-${randomUUID()}.tmp`);
  try {
    await requireDirectory(folder);
    await writeFile(pending, bytes, { flag: "wx", flush: true });
    await rename(pending, join(folder, "name.json"));
  } catch (error) {
    await rm(pending, { force: true }).catch(() => undefined);
    throw error;
  }
}
