import { pageUpload, previewHtml, previewLimits, sha256 } from "@easy-proto/preview";
import { boundedBody, error, json } from "./http.ts";

const publicId = /^[a-f0-9-]{36}$/;
const encoder = new TextEncoder();

async function allowedPublisher(request: Request, token: string | undefined) {
  const url = new URL(request.url);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    request.headers.has("origin") ||
    !token
  )
    return false;
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer [\w-]{43,128}$/.test(authorization)) return false;
  const supplied = authorization.slice(7);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(supplied));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(token));
}

async function uploadMember(
  form: FormData,
  key: string,
  type: string,
  member: { bytes: number; digest: string },
) {
  const file = form.get(key);
  if (!(file instanceof File) || file.type !== type || file.size !== member.bytes)
    throw new Error("INVALID_MEMBER");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if ((await sha256(bytes)) !== member.digest) throw new Error("INVALID_MEMBER");
  return bytes;
}

export async function publish(request: Request, env: Env, url: URL) {
  const path = url.pathname;
  if (!(await allowedPublisher(request, env.LOCAL_PUBLISH_TOKEN)))
    return error("Local publisher unavailable.", 403);
  if (path === "/api/local/page" && request.method === "GET") {
    const projectId = url.searchParams.get("projectId");
    const pageId = url.searchParams.get("pageId");
    if (!projectId || !pageId || !publicId.test(projectId) || !publicId.test(pageId))
      return error("Invalid page.", 400);
    const saved = await env.DB.prepare(
      "SELECT id, source_revision AS revision, updated_at AS updatedAt FROM page_previews WHERE project_id = ? AND page_id = ?",
    )
      .bind(projectId, pageId)
      .first();
    return json({ preview: saved });
  }
  if (path !== "/api/local/sync" || request.method !== "POST") return error("Not found.", 404);
  const bytes = await boundedBody(request, previewLimits.uploadBytes);
  const form = await new Response(bytes, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
  const metadata = form.get("manifest");
  if (typeof metadata !== "string" || metadata.length > 100_000)
    return error("Invalid page manifest.", 400);
  const upload = pageUpload.parse(JSON.parse(metadata));
  const files = new Map<string, { bytes: Uint8Array<ArrayBuffer>; type: string }>();
  const expectedMembers =
    1 +
    upload.manifest.artboards.reduce(
      (count, board) => count + 2 + Number(Boolean(board.tokens)) + board.assets.length,
      0,
    );
  if ([...form.keys()].length !== expectedMembers) return error("Unexpected preview files.", 400);
  for (const board of upload.manifest.artboards) {
    try {
      const document = await uploadMember(
        form,
        `${board.id}:document`,
        "text/html",
        board.document,
      );
      const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(document);
      if (previewHtml(decoded, Boolean(board.tokens)) !== decoded)
        return error("Artboard HTML is not a sanitized preview document.", 400);
      files.set(`${board.id}/index.html`, { bytes: document, type: "text/html; charset=utf-8" });
      files.set(`${board.id}/board.css`, {
        bytes: await uploadMember(form, `${board.id}:stylesheet`, "text/css", board.stylesheet),
        type: "text/css; charset=utf-8",
      });
      if (board.tokens)
        files.set(`${board.id}/tokens.css`, {
          bytes: await uploadMember(form, `${board.id}:tokens`, "text/css", board.tokens),
          type: "text/css; charset=utf-8",
        });
      for (const [index, asset] of board.assets.entries())
        files.set(`${board.id}/assets/${asset.path}`, {
          bytes: await uploadMember(form, `${board.id}:asset:${index}`, asset.mime, asset),
          type: asset.mime,
        });
    } catch {
      return error("Preview file verification failed.", 400);
    }
  }
  const snapshotId = crypto.randomUUID();
  const prefix = `snapshots/${snapshotId}/`;
  const now = new Date().toISOString();
  const stored: string[] = [];
  try {
    for (const [path, member] of files) {
      const key = `${prefix}${path}`;
      stored.push(key);
      await env.PREVIEWS.put(key, member.bytes, { httpMetadata: { contentType: member.type } });
    }
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO snapshots(id, manifest, created_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM page_previews WHERE project_id = ? AND page_id = ? AND source_revision > ?)",
      ).bind(
        snapshotId,
        JSON.stringify(upload.manifest),
        now,
        upload.projectId,
        upload.pageId,
        upload.manifest.revision,
      ),
      env.DB.prepare(
        "INSERT INTO page_previews(id, project_id, page_id, snapshot_id, source_revision, updated_at) SELECT ?, ?, ?, id, ?, ? FROM snapshots WHERE id = ? ON CONFLICT(project_id, page_id) DO UPDATE SET snapshot_id = excluded.snapshot_id, source_revision = excluded.source_revision, updated_at = excluded.updated_at WHERE excluded.source_revision >= page_previews.source_revision RETURNING id",
      ).bind(
        crypto.randomUUID(),
        upload.projectId,
        upload.pageId,
        upload.manifest.revision,
        now,
        snapshotId,
      ),
    ]);
    const saved = results[1].results[0] as { id: string } | undefined;
    if (!saved) {
      await env.PREVIEWS.delete(stored);
      return error("A newer page revision was already synced.", 409);
    }
    return json({ id: saved.id, revision: upload.manifest.revision, updatedAt: now });
  } catch (failure) {
    await env.PREVIEWS.delete(stored).catch(() => {});
    throw failure;
  }
}
