import { pageUpload, previewHtml, previewLimits, sha256 } from "@easy-proto/preview";
import { boundedBody, error, json } from "./http.ts";
import {
  admit,
  allowedHostedPublisher,
  generatePassword,
  hostedSite,
  hostedUploadBytes,
  limitReached,
  reserveStorage,
  savePassword,
} from "./hosted-access.ts";
import { claimPublication, releasePublication } from "./hosted-publications.ts";

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

export async function publish(request: Request, env: Env, url: URL, hosted = false) {
  const path = url.pathname;
  const endpoint = hosted ? "/api/hosted" : "/api/local";
  const site = hosted ? hostedSite(env) : undefined;
  if (
    !(hosted
      ? await allowedHostedPublisher(request, env)
      : await allowedPublisher(request, env.LOCAL_PUBLISH_TOKEN))
  )
    return error("Publisher unavailable.", 403);
  if (path === endpoint + "/page" && request.method === "GET") {
    const projectId = url.searchParams.get("projectId");
    const pageId = url.searchParams.get("pageId");
    if (!projectId || !pageId || !publicId.test(projectId) || !publicId.test(pageId))
      return error("Invalid page.", 400);
    const saved = await env.DB.prepare(
      hosted
        ? "SELECT p.id, p.source_revision AS revision, p.updated_at AS updatedAt, CASE WHEN h.verifier IS NULL THEN 'public' ELSE 'protected' END AS access FROM page_previews p JOIN hosted_shares h ON h.id=p.id WHERE p.project_id=? AND p.page_id=?"
        : "SELECT id, source_revision AS revision, updated_at AS updatedAt FROM page_previews WHERE project_id = ? AND page_id = ?",
    )
      .bind(projectId, pageId)
      .first();
    return json({ preview: saved });
  }
  if (path !== endpoint + "/sync" || request.method !== "POST") return error("Not found.", 404);
  const requestId = site ? request.headers.get("idempotency-key") : null;
  if (site && (!requestId || !publicId.test(requestId)))
    return error("A sync request ID is required.", 400);
  const bytes = await boundedBody(request, hosted ? hostedUploadBytes : previewLimits.uploadBytes);
  const form = await new Response(bytes, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
  const metadata = form.get("manifest");
  if (typeof metadata !== "string" || metadata.length > 100_000)
    return error("Invalid page manifest.", 400);
  const upload = pageUpload.parse(JSON.parse(metadata));
  const access = site ? form.get("access") : null;
  if (access !== null && access !== "protected" && access !== "public")
    return error("Invalid preview access.", 400);
  const files = new Map<string, { bytes: Uint8Array<ArrayBuffer>; type: string }>();
  const expectedMembers =
    1 +
    upload.manifest.artboards.reduce(
      (count, board) => count + 2 + Number(Boolean(board.tokens)) + board.assets.length,
      0,
    );
  if ([...form.keys()].length !== expectedMembers + Number(access !== null))
    return error("Unexpected preview files.", 400);
  if (hosted && (expectedMembers > 26 || upload.manifest.artboards.length > 8))
    return error("Hosted previews support up to 8 artboards and 25 files.", 413);
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
  const password =
    site && requestId && access === "protected"
      ? await generatePassword(site.key, requestId)
      : undefined;
  let snapshotId = crypto.randomUUID();
  if (requestId) {
    const fingerprint = await sha256(
      new Uint8Array(encoder.encode(JSON.stringify({ upload, access }))),
    );
    const claim = await claimPublication(env, requestId, fingerprint);
    if (claim.kind === "rejected") return claim.failure;
    if (claim.kind === "replayed") return json({ ...claim.result, password });
    snapshotId = claim.snapshot;
  }
  const prefix = `snapshots/${snapshotId}/`;
  const now = new Date().toISOString();
  const stored: string[] = [];
  let attemptedCommit = false;
  try {
    if (site && !(await admit(env, "upload", 86400, 10))) return limitReached();
    if (site && !(await reserveStorage(env, bytes.byteLength)))
      return error("Hosted storage is full. Ask the owner to free space before syncing.", 507);
    const verifier = site && password ? await savePassword(site.key, password) : null;
    for (const [path, member] of files) {
      const key = `${prefix}${path}`;
      stored.push(key);
      await env.PREVIEWS.put(key, member.bytes, { httpMetadata: { contentType: member.type } });
    }
    const statements = [
      env.DB.prepare(
        "INSERT INTO snapshots(id, manifest, created_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM page_previews WHERE project_id = ? AND page_id = ? AND source_revision > ?)" +
          (requestId
            ? " AND EXISTS (SELECT 1 FROM hosted_publications WHERE request_id=? AND snapshot_id=? AND result IS NULL)"
            : ""),
      ).bind(
        snapshotId,
        JSON.stringify(upload.manifest),
        now,
        upload.projectId,
        upload.pageId,
        upload.manifest.revision,
        ...(requestId ? [requestId, snapshotId] : []),
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
    ];
    if (site)
      statements.push(
        env.DB.prepare(
          "INSERT INTO hosted_shares(id, verifier, epoch) SELECT id, ?, 1 FROM page_previews WHERE snapshot_id = ? ON CONFLICT(id) DO UPDATE SET verifier = CASE WHEN ? IS NULL THEN hosted_shares.verifier ELSE excluded.verifier END, epoch = hosted_shares.epoch + (? IS NOT NULL) RETURNING verifier IS NOT NULL AS locked",
        ).bind(verifier, snapshotId, access, access),
      );
    if (requestId)
      statements.push(
        env.DB.prepare(
          "UPDATE hosted_publications SET result=(SELECT json_object('id', p.id, 'revision', p.source_revision, 'updatedAt', p.updated_at, 'access', CASE WHEN h.verifier IS NULL THEN 'public' ELSE 'protected' END) FROM page_previews p JOIN hosted_shares h ON h.id=p.id WHERE p.snapshot_id=?) WHERE request_id=? AND snapshot_id=? AND result IS NULL RETURNING result",
        ).bind(snapshotId, requestId, snapshotId),
      );
    attemptedCommit = true;
    const results = await env.DB.batch(statements);
    const saved = results[1].results[0] as { id: string } | undefined;
    if (!saved) {
      await env.PREVIEWS.delete(stored);
      return error("A newer page revision was already synced.", 409);
    }
    if (requestId) {
      const committed = results[3].results[0] as { result: string };
      return json({ ...JSON.parse(committed.result), password });
    }
    return json({
      id: saved.id,
      revision: upload.manifest.revision,
      updatedAt: now,
    });
  } catch (failure) {
    // An ambiguous commit response must not delete bytes a hosted pointer may reference.
    if (!site || !attemptedCommit) await env.PREVIEWS.delete(stored).catch(() => {});
    throw failure;
  } finally {
    if (requestId) await releasePublication(env, requestId, snapshotId).catch(() => {});
  }
}
