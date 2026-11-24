import {
  pageUpload,
  previewHtml,
  previewLimits,
  previewManifest,
  sha256,
  type PreviewManifest,
} from "@easy-proto/preview";

const publicId = /^[a-f0-9-]{36}$/;
const encoder = new TextEncoder();
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
const policy =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers });
}
function error(message: string, status: number) {
  return json({ error: message }, status);
}

async function boundedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("BODY_LIMIT");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("EMPTY_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("BODY_LIMIT");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.length;
  }
  return bytes;
}

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

function htmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/health" && request.method === "GET") {
    await env.DB.prepare("SELECT count(*) FROM waitlist").first();
    return json({ ready: true, service: "easy-proto-web" });
  }
  if (path === "/api/waitlist" && request.method === "POST") {
    if (
      request.headers.get("origin") !== url.origin ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      return error("Request not allowed.", 403);
    const payload = JSON.parse(new TextDecoder().decode(await boundedBody(request, 2048)));
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return error("Invalid request.", 400);
    if (typeof payload.website === "string" && payload.website) return json({ accepted: true });
    if (typeof payload.email !== "string") return error("Enter a valid email address.", 400);
    const email = payload.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return error("Enter a valid email address.", 400);
    await env.DB.prepare(
      "INSERT INTO waitlist(email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING",
    )
      .bind(email, new Date().toISOString())
      .run();
    return json({ accepted: true });
  }
  if (path.startsWith("/api/local/")) {
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
        const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
          document,
        );
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
  const previewRoute = /^\/(?:api\/previews|p)\/([a-f0-9-]{36})$/.exec(path);
  let sharedPage: ReturnType<typeof view> | undefined;
  if (previewRoute && request.method === "GET") {
    const saved = await env.DB.prepare(
      "SELECT p.id, p.snapshot_id, p.updated_at, s.manifest FROM page_previews p JOIN snapshots s ON s.id = p.snapshot_id WHERE p.id = ?",
    )
      .bind(previewRoute[1])
      .first<{ id: string; snapshot_id: string; updated_at: string; manifest: string }>();
    if (!saved) return error("Preview unavailable.", 404);
    sharedPage = view(
      saved.id,
      saved.snapshot_id,
      saved.updated_at,
      previewManifest.parse(JSON.parse(saved.manifest)),
    );
    if (path.startsWith("/api/") || request.headers.get("accept") === "application/json")
      return json(sharedPage);
  }
  const artifact = /^\/preview-artifacts\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/(.+)$/.exec(path);
  if (artifact && (request.method === "GET" || request.method === "HEAD") && !url.search) {
    const snapshot = await env.DB.prepare("SELECT manifest FROM snapshots WHERE id = ?")
      .bind(artifact[1])
      .first<{ manifest: string }>();
    if (!snapshot) return error("Preview unavailable.", 404);
    const manifest = previewManifest.parse(JSON.parse(snapshot.manifest));
    const board = manifest.artboards.find(({ id }) => id === artifact[2]);
    if (!board) return error("Preview unavailable.", 404);
    let resource: string;
    try {
      const parts = artifact[3].split("/").map((part) => decodeURIComponent(part));
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
    const object = await env.PREVIEWS.get(`snapshots/${artifact[1]}/${board.id}/${resource}`);
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
      const base = `${url.origin}/preview-artifacts/${artifact[1]}/${board.id}/`;
      responseHeaders["content-security-policy"] =
        `sandbox; default-src 'none'; style-src 'unsafe-inline' ${base}board.css ${base}tokens.css; ` +
        `img-src ${base}assets/ data:; font-src ${base}assets/; connect-src 'none'; ` +
        "frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";
    }
    return new Response(request.method === "HEAD" ? null : object.body, {
      headers: responseHeaders,
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD")
    return error("Method not allowed.", 405);
  if (path === "/" && request.headers.get("accept") === "application/json")
    return json({ kind: "landing" });
  if (path.startsWith("/api/") || path.startsWith("/preview-artifacts/"))
    return error("Not found.", 404);
  const response = await env.ASSETS.fetch(request);
  let body: BodyInit | null = response.body;
  if (sharedPage && response.ok) {
    const data = JSON.stringify(sharedPage).replaceAll("<", "\\u003c");
    body = (await response.text())
      .replace(
        /<title>[^<]*<\/title>/,
        `<title>${htmlText(sharedPage.projectName)} - ${htmlText(sharedPage.pageName)}</title>`,
      )
      .replace(
        '<div id="root"></div>',
        `<div id="root"></div><script id="page-data" type="application/json">${data}</script>`,
      );
  }
  const secured = new Response(body, response);
  secured.headers.delete("Content-Length");
  secured.headers.set("Content-Security-Policy", policy);
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  return secured;
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      return await handleRequest(request, env);
    } catch (failure) {
      if (failure instanceof Error && failure.message === "BODY_LIMIT")
        return error("This page exceeds the local preview size limit.", 413);
      if (
        failure instanceof SyntaxError ||
        (failure instanceof Error && failure.name === "ZodError")
      )
        return error("Invalid request.", 400);
      console.error(
        JSON.stringify({
          event: "web_request_failed",
          path: new URL(request.url).pathname.startsWith("/api/local/") ? "local-publish" : "web",
        }),
      );
      return error("The preview service could not complete this request.", 500);
    }
  },
};
