import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { z } from "zod";
import { pageUpload, previewHtml, previewLimits, type WebPreviewInfo } from "@easy-proto/preview";
import { Project, type Snapshot } from "../document/project";
import type { Artboard } from "../../shared/model";
import { createHash, randomUUID } from "node:crypto";

export type WebPreviewSettings = { origin: string; token: string; mode?: "hosted" };
const settingsSchema = z.strictObject({
  origin: z.url(),
  token: z.string().regex(/^[\w-]{43,128}$/),
  mode: z.literal("hosted").optional(),
});
const savedSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
  access: z.enum(["public", "protected"]).optional(),
  password: z
    .string()
    .regex(/^[\w-]{22}$/)
    .optional(),
});

export async function readWebPreviewSettings(
  path: string | undefined,
  env = process.env,
): Promise<WebPreviewSettings | undefined> {
  let value: unknown;
  if (env.EASY_PROTO_WEB_HOSTED_ORIGIN || env.EASY_PROTO_WEB_HOSTED_TOKEN)
    value = {
      origin: env.EASY_PROTO_WEB_HOSTED_ORIGIN,
      token: env.EASY_PROTO_WEB_HOSTED_TOKEN,
      mode: "hosted",
    };
  else if (env.EASY_PROTO_WEB_ORIGIN || env.EASY_PROTO_WEB_TOKEN)
    value = { origin: env.EASY_PROTO_WEB_ORIGIN, token: env.EASY_PROTO_WEB_TOKEN };
  else if (path) {
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ).catch((failure: NodeJS.ErrnoException) => {
      if (failure.code !== "ENOENT")
        throw new Error("Local web preview settings could not be read.");
      return undefined;
    });
    if (file) {
      try {
        const stat = await file.stat();
        const buffer = Buffer.alloc(1025);
        if (!stat.isFile() || stat.size > 1024)
          throw new Error("Invalid web preview settings file.");
        const { bytesRead } = await file.read(buffer);
        if (bytesRead > 1024) throw new Error("Invalid web preview settings file.");
        if (bytesRead) {
          const parsed = settingsSchema.parse(JSON.parse(buffer.toString("utf8", 0, bytesRead)));
          if (
            parsed.mode === "hosted" &&
            (stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
          )
            throw new Error(
              "Hosted preview settings must be a private file owned by your account.",
            );
          value = parsed;
        }
      } finally {
        await file.close();
      }
    }
  }
  if (!value) return;
  const settings = settingsSchema.parse(value);
  const origin = new URL(settings.origin);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
    throw new Error("The preview endpoint must be an origin.");
  if (settings.mode === "hosted") {
    if (
      origin.protocol !== "https:" ||
      !["easyproto.app", "staging.easyproto.app"].includes(origin.host) ||
      settings.token.length !== 43
    )
      throw new Error("Hosted preview settings must use an Easy Proto HTTPS origin.");
    return { origin: origin.origin, token: settings.token, mode: "hosted" };
  }
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
    throw new Error("The local preview endpoint must be an HTTP loopback origin.");
  return { origin: origin.origin, token: settings.token };
}

function endpoint(settings: WebPreviewSettings, action: "page" | "sync") {
  return new URL(`/api/${settings.mode ?? "local"}/${action}`, settings.origin);
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
    if (response.status === 413)
      throw new Error(
        "This page exceeds the preview limits. Try fewer artboards or smaller assets.",
      );
    if (response.status === 429)
      throw new Error("The preview usage limit has been reached. Try again later.");
    if (response.status === 425)
      throw new Error("This sync is still finishing. Try again shortly.");
    if (response.status === 507)
      throw new Error("Hosted preview storage is full. Free up space before syncing again.");
    throw new Error(
      "The preview service could not sync this page. Check the connection and try again.",
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
  const url = endpoint(settings, "page");
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
    ...(settings.mode === "hosted" ? { hosted: true, access: preview?.access } : {}),
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
  access?: "public" | "protected",
  requestId?: string,
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
        `“${board.name}” has unavailable images or fonts. ${details.unresolved.slice(0, 2).join(". ")}`,
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
  if (settings.mode === "hosted" && access) body.set("access", access);
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
  const response = await request(endpoint(settings, "sync"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${settings.token}`,
      ...(settings.mode === "hosted" ? { "idempotency-key": requestId ?? randomUUID() } : {}),
    },
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
    ...(settings.mode === "hosted"
      ? { hosted: true, access: saved.access, password: saved.password }
      : {}),
  };
}
