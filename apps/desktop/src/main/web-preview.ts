import { readFile } from "node:fs/promises";
import { z } from "zod";
import { pageUpload, previewHtml, previewLimits, type WebPreviewInfo } from "@easy-proto/preview";
import { Project, type Snapshot } from "./project";
import type { Artboard } from "../shared/model";
import { createHash } from "node:crypto";

export type WebPreviewSettings = { origin: string; token: string };
const settingsSchema = z.strictObject({
  origin: z.url(),
  token: z.string().regex(/^[\w-]{43,128}$/),
});
const savedSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});

export async function readWebPreviewSettings(
  path: string | undefined,
  env = process.env,
): Promise<WebPreviewSettings | undefined> {
  let value: unknown;
  if (env.EASY_PROTO_WEB_ORIGIN || env.EASY_PROTO_WEB_TOKEN)
    value = { origin: env.EASY_PROTO_WEB_ORIGIN, token: env.EASY_PROTO_WEB_TOKEN };
  else if (path) {
    const contents = await readFile(path, "utf8").catch((failure: NodeJS.ErrnoException) => {
      if (failure.code !== "ENOENT")
        throw new Error("Local web preview settings could not be read.");
    });
    if (contents) value = JSON.parse(contents);
  }
  if (!value) return;
  const settings = settingsSchema.parse(value);
  const origin = new URL(settings.origin);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("The local preview endpoint must be an HTTP loopback origin.");
  return { origin: origin.origin, token: settings.token };
}

export function pageInfo(project: Project, pageId: string, configured: boolean): WebPreviewInfo {
  const page = project.pageLayout.pages.find(({ id }) => id === pageId);
  if (!page) throw new Error("The selected page no longer exists.");
  return {
    configured,
    pageName: page.name,
    artboardCount: project.snapshot.manifest.artboards.filter(
      (board) => (board.pageId ?? project.pageLayout.defaultPageId) === pageId,
    ).length,
  };
}

async function responseData(response: Response) {
  if (!response.ok) {
    if (response.status === 409)
      throw new Error("A newer revision is already online. Refresh the page and sync again.");
    throw new Error(
      "The local preview service could not sync this page. Check that the local web environment is running.",
    );
  }
  return response.json();
}

export async function webPreviewStatus(
  project: Project,
  pageId: string,
  settings: WebPreviewSettings,
  signal?: AbortSignal,
  request = fetch,
): Promise<WebPreviewInfo> {
  const url = new URL("/api/local/page", settings.origin);
  url.searchParams.set("projectId", project.snapshot.manifest.projectId);
  url.searchParams.set("pageId", pageId);
  const response = await request(url, {
    headers: { authorization: `Bearer ${settings.token}` },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
      : AbortSignal.timeout(5000),
    redirect: "error",
  });
  const { preview } = z
    .object({ preview: savedSchema.nullable() })
    .parse(await responseData(response));
  return {
    ...pageInfo(project, pageId, true),
    ...(preview
      ? {
          url: `${settings.origin}/p/${preview.id}`,
          revision: preview.revision,
          updatedAt: preview.updatedAt,
        }
      : {}),
  };
}

type Capture = (
  snapshot: Snapshot,
  board: Artboard,
  signal: AbortSignal,
) => Promise<{ png: Buffer; details: { unresolved: string[]; assets?: string[] } }>;
export async function syncPagePreview(
  project: Project,
  expectedRevision: number,
  pageId: string,
  settings: WebPreviewSettings,
  capture: Capture,
  signal: AbortSignal,
  request = fetch,
): Promise<WebPreviewInfo> {
  const snapshot = project.snapshot;
  if (snapshot.manifest.revision !== expectedRevision)
    throw new Error("The project changed. Close this dialog and try again.");
  const info = pageInfo(project, pageId, true);
  const boards = snapshot.manifest.artboards.filter(
    (board) => (board.pageId ?? project.pageLayout.defaultPageId) === pageId,
  );
  if (!boards.length) throw new Error("Add an artboard to this page before creating a preview.");
  if (boards.length > previewLimits.boards)
    throw new Error(`Local previews support up to ${previewLimits.boards} artboards per page.`);
  const members: {
    board: Artboard;
    document: Buffer;
    stylesheet: Buffer;
    tokens?: Buffer;
    assets: { path: string; mime: string; bytes: Buffer }[];
  }[] = [];
  let total = 100_000;
  for (const board of boards) {
    signal.throwIfAborted();
    const { details } = await capture(snapshot, board, signal);
    if (details.unresolved.length)
      throw new Error(
        `“${board.name}” has unavailable images or fonts. Resolve them before syncing.`,
      );
    const source = snapshot.sources.get(board.id);
    if (!source) throw new Error(`“${board.name}” has no saved source.`);
    const document = Buffer.from(previewHtml(source.html, Boolean(snapshot.tokens?.css)));
    const stylesheet = Buffer.from(source.css);
    const tokens = snapshot.tokens?.css ? Buffer.from(snapshot.tokens.css) : undefined;
    const assets = [...new Set(details.assets ?? [])].map((path) => {
      const asset = project.assets.get(path);
      if (!asset) throw new Error(`“${board.name}” uses an unavailable asset.`);
      return { path, mime: asset.mime, bytes: asset.bytes };
    });
    if (
      document.length > previewLimits.documentBytes ||
      stylesheet.length > previewLimits.stylesheetBytes ||
      (tokens && tokens.length > previewLimits.tokenBytes) ||
      assets.length > previewLimits.assetsPerBoard ||
      assets.some(({ bytes }) => bytes.length > previewLimits.assetBytes)
    )
      throw new Error("This page is too large for the local preview. Export a smaller page.");
    total +=
      document.length +
      stylesheet.length +
      (tokens?.length ?? 0) +
      assets.reduce((sum, asset) => sum + asset.bytes.length, 0) +
      512;
    if (total > previewLimits.uploadBytes)
      throw new Error("This page is too large for the local preview. Export a smaller page.");
    members.push({ board, document, stylesheet, tokens, assets });
  }
  signal.throwIfAborted();
  const upload = pageUpload.parse({
    projectId: snapshot.manifest.projectId,
    pageId,
    manifest: {
      schemaVersion: 2,
      projectName: project.name,
      pageName: info.pageName,
      revision: snapshot.manifest.revision,
      artboards: members.map(({ board, document, stylesheet, tokens, assets }) => ({
        id: board.id,
        name: board.name,
        x: board.x,
        y: board.y,
        width: board.width,
        height: board.height,
        document: {
          bytes: document.length,
          digest: createHash("sha256").update(document).digest("hex"),
        },
        stylesheet: {
          bytes: stylesheet.length,
          digest: createHash("sha256").update(stylesheet).digest("hex"),
        },
        ...(tokens
          ? {
              tokens: {
                bytes: tokens.length,
                digest: createHash("sha256").update(tokens).digest("hex"),
              },
            }
          : {}),
        assets: assets.map(({ path, mime, bytes }) => ({
          path,
          mime,
          bytes: bytes.length,
          digest: createHash("sha256").update(bytes).digest("hex"),
        })),
      })),
    },
  });
  const body = new FormData();
  body.set("manifest", JSON.stringify(upload));
  for (const { board, document, stylesheet, tokens, assets } of members) {
    body.set(
      `${board.id}:document`,
      new Blob([new Uint8Array(document)], { type: "text/html" }),
      "index.html",
    );
    body.set(
      `${board.id}:stylesheet`,
      new Blob([new Uint8Array(stylesheet)], { type: "text/css" }),
      "board.css",
    );
    if (tokens)
      body.set(
        `${board.id}:tokens`,
        new Blob([new Uint8Array(tokens)], { type: "text/css" }),
        "tokens.css",
      );
    assets.forEach((asset, index) =>
      body.set(
        `${board.id}:asset:${index}`,
        new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }),
        asset.path.split("/").at(-1) ?? "asset",
      ),
    );
  }
  const response = await request(new URL("/api/local/sync", settings.origin), {
    method: "POST",
    headers: { authorization: `Bearer ${settings.token}` },
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
    redirect: "error",
  });
  const saved = savedSchema.parse(await responseData(response));
  return {
    ...info,
    url: `${settings.origin}/p/${saved.id}`,
    revision: saved.revision,
    updatedAt: saved.updatedAt,
  };
}
