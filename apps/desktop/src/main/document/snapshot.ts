import { createHash } from "node:crypto";
import { source, type Artboard, type Manifest, type Source } from "../../shared/model";
import { loadTokens, type TokenBundle } from "./tokens";

export function digest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value !== null && typeof value === "object") {
    return JSON.stringify(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : Number(left > right)))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return JSON.stringify(value);
}

export type Snapshot = {
  manifest: Manifest;
  sources: ReadonlyMap<string, Source>;
  tokens?: TokenBundle;
};
export type Asset = { bytes: Buffer; mime: string };

type TokenFiles = { document: string; css: string };
export async function validateSnapshot(
  manifest: Manifest,
  readSource: (board: Artboard) => unknown | Promise<unknown>,
  readTokenFiles: () => TokenFiles | undefined | Promise<TokenFiles>,
): Promise<Snapshot> {
  const { pageLayout } = manifest;
  const pageIds = new Set(pageLayout?.pages.map(({ id }) => id));
  if (
    manifest.schemaVersion >= 4 !== Boolean(pageLayout) ||
    (manifest.schemaVersion < 5 && manifest.tokens !== undefined) ||
    (pageLayout &&
      (pageIds.size !== pageLayout.pages.length || !pageIds.has(pageLayout.defaultPageId)))
  )
    throw new Error("Invalid project pages.");
  const sources = new Map<string, Source>();
  for (const board of manifest.artboards) {
    if (
      sources.has(board.id) ||
      (board.pageId === undefined ? manifest.schemaVersion >= 4 : !pageIds.has(board.pageId)) ||
      board.htmlRef !== `${board.id}.html` ||
      board.cssRef !== `${board.id}.css` ||
      board.sourceRevision > manifest.revision
    )
      throw new Error("Invalid artboard metadata.");
    const content = source.parse(await readSource(board));
    if (board.sourceDigest !== digest(canonical(content)))
      throw new Error("Artboard source has changed on disk.");
    sources.set(board.id, content);
  }
  const commands = new Set<string>();
  for (const { result } of manifest.commands) {
    if (
      commands.has(result.commandId) ||
      result.projectId !== manifest.projectId ||
      result.revision < 1 ||
      result.revision > manifest.revision
    ) {
      throw new Error("Invalid command history.");
    }
    if ("artboard" in result) {
      const affected = result.artboards ?? [result.artboard];
      if (
        (manifest.schemaVersion === 1 && !sources.has(result.artboard.id)) ||
        (result.artboards &&
          (manifest.schemaVersion < 3 ||
            canonical(result.artboard) !== canonical(affected[0]) ||
            new Set(affected.map(({ id }) => id)).size !== affected.length)) ||
        affected.some(
          (board) =>
            (board.pageId !== undefined && manifest.schemaVersion < 4) ||
            board.htmlRef !== `${board.id}.html` ||
            board.cssRef !== `${board.id}.css` ||
            board.sourceRevision > result.revision,
        )
      )
        throw new Error("Invalid artboard command history.");
    } else if (manifest.schemaVersion < ("tokens" in result ? 5 : 4)) {
      throw new Error("Invalid project command history.");
    }
    commands.add(result.commandId);
  }
  let tokens: TokenBundle | undefined;
  if (manifest.tokens) {
    const files = await readTokenFiles();
    if (!files) throw new Error("The token files are missing.");
    tokens = loadTokens(files.document, files.css, manifest.tokens);
  }
  return { manifest, sources, tokens };
}
