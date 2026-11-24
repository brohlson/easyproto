import { previewManifest, type PreviewManifest } from "@easy-proto/preview";
import { error, headers } from "./http.ts";

function view(id: string, snapshotId: string, updatedAt: string, manifest: PreviewManifest) {
  const { revision: _revision, ...publicManifest } = manifest;
  return {
    kind: "page-preview",
    id,
    ...publicManifest,
    updatedAt,
    artboards: manifest.artboards.map(
      ({
        document: _document,
        stylesheet: _stylesheet,
        tokens: _tokens,
        assets: _assets,
        ...board
      }) => ({
        ...board,
        iframeUrl: `/preview-artifacts/${snapshotId}/${board.id}/index.html`,
      }),
    ),
  };
}

export type PublicPreview = ReturnType<typeof view>;

export async function readPreview(env: Env, id: string) {
  const saved = await env.DB.prepare(
    "SELECT p.id, p.snapshot_id, p.updated_at, s.manifest FROM page_previews p JOIN snapshots s ON s.id = p.snapshot_id WHERE p.id = ?",
  )
    .bind(id)
    .first<{ id: string; snapshot_id: string; updated_at: string; manifest: string }>();
  if (!saved) return undefined;
  return view(
    saved.id,
    saved.snapshot_id,
    saved.updated_at,
    previewManifest.parse(JSON.parse(saved.manifest)),
  );
}

export async function serveArtifact(
  request: Request,
  env: Env,
  url: URL,
  artifact: RegExpExecArray,
) {
  const snapshot = await env.DB.prepare("SELECT manifest FROM snapshots WHERE id = ?")
    .bind(artifact[1])
    .first<{ manifest: string }>();
  if (!snapshot) return error("Preview unavailable.", 404);
  const manifest = previewManifest.parse(JSON.parse(snapshot.manifest));
  const prefix = `/preview-artifacts/${artifact[1]}/${artifact[2]}/`;
  return serveBoardFile(
    request,
    env,
    artifact[1],
    manifest,
    artifact[2],
    artifact[3],
    url.origin + prefix,
    "'self'",
  );
}

export async function serveBoardFile(
  request: Request,
  env: Env,
  snapshot: string,
  manifest: PreviewManifest,
  boardId: string,
  relative: string,
  base: string,
  ancestor: string,
) {
  const board = manifest.artboards.find(({ id }) => id === boardId);
  if (!board) return error("Preview unavailable.", 404);
  let resource: string;
  try {
    const parts = relative.split("/").map((part) => decodeURIComponent(part));
    if (
      parts.some(
        // oxlint-disable-next-line no-control-regex
        (part) => !part || part === "." || part === ".." || /[/\\\u0000-\u001f]/.test(part),
      )
    )
      return error("Preview unavailable.", 404);
    resource = parts.join("/");
  } catch {
    return error("Preview unavailable.", 404);
  }
  const allowed =
    resource === "index.html" ||
    resource === "board.css" ||
    (resource === "tokens.css" && Boolean(board.tokens)) ||
    (resource.startsWith("assets/") &&
      board.assets.some(({ path }) => path === resource.slice("assets/".length)));
  if (!allowed) return error("Preview unavailable.", 404);
  const key = `snapshots/${snapshot}/${board.id}/${resource}`;
  const head = request.method === "HEAD";
  const object = head ? await env.PREVIEWS.head(key) : await env.PREVIEWS.get(key);
  if (!object) return error("Preview unavailable.", 404);
  const responseHeaders = { ...headers } as Record<string, string>;
  const entry = resource === "index.html";
  responseHeaders["content-type"] = entry
    ? "text/html; charset=utf-8"
    : resource.endsWith(".css")
      ? "text/css; charset=utf-8"
      : (board.assets.find(({ path }) => path === resource.slice("assets/".length))?.mime ??
        "application/octet-stream");
  if (entry) {
    responseHeaders["content-security-policy"] =
      `sandbox; default-src 'none'; style-src 'unsafe-inline' ${base}board.css ${base}tokens.css; ` +
      `img-src ${base}assets/ data:; font-src ${base}assets/; connect-src 'none'; ` +
      `frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors ${ancestor}`;
  }
  if (responseHeaders["content-type"].startsWith("font/")) {
    // A sandboxed document has an opaque origin even on the artifact host.
    responseHeaders["access-control-allow-origin"] = "*";
  }
  return new Response(head ? null : (object as R2ObjectBody).body, {
    headers: responseHeaders,
  });
}
