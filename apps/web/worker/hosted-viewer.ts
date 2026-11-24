import { previewManifest } from "@easy-proto/preview";
import {
  admit,
  admitUnlock,
  artifactGrant,
  checkPassword,
  guestCookie,
  hostedSite,
  isGuest,
  limitReached,
  readArtifactGrant,
} from "./hosted-access.ts";
import { boundedBody, error, headers, json } from "./http.ts";
import { serveBoardFile } from "./previews.ts";
import { serveSite } from "./site.ts";

type HostedSite = NonNullable<ReturnType<typeof hostedSite>>;
const unavailable = () => error("Preview unavailable.", 404);

async function currentShare(env: Env, id: string) {
  const row = await env.DB.prepare(
    "SELECT p.snapshot_id, p.updated_at, h.epoch, h.verifier, s.manifest FROM page_previews p JOIN hosted_shares h ON h.id=p.id JOIN snapshots s ON s.id=p.snapshot_id WHERE p.id=?",
  )
    .bind(id)
    .first<{
      snapshot_id: string;
      updated_at: string;
      epoch: number;
      verifier: string | null;
      manifest: string;
    }>();
  return row ?? undefined;
}

export async function hostedArtifact(request: Request, env: Env, url: URL, site: HostedSite) {
  const match = /^\/g\/([a-zA-Z0-9_.-]{1,160})\/([a-f0-9-]{36})\/(.+)$/.exec(url.pathname);
  if (!match || url.search || !["GET", "HEAD"].includes(request.method)) return unavailable();
  const [, grant, board, relative] = match;
  const scope = await readArtifactGrant(site.key, grant, board);
  if (!scope) return unavailable();
  const shared = await currentShare(env, scope.id);
  if (shared?.epoch !== scope.epoch || shared.snapshot_id !== scope.snapshot) return unavailable();
  if (!(await admit(env, "artifacts", 86400, 5000))) return limitReached();
  return serveBoardFile(
    request,
    env,
    scope.snapshot,
    previewManifest.parse(JSON.parse(shared.manifest)),
    board,
    relative,
    `${site.artifacts}/g/${grant}/${board}/`,
    site.viewer,
  );
}

export async function hostedPreview(request: Request, env: Env, url: URL, site: HostedSite) {
  const match = /^\/(p|api\/previews)\/([a-f0-9-]{36})(?:\/(unlock|tokens))?$/.exec(url.pathname);
  if (!match || url.search) return unavailable();
  const [, surface, id, action] = match;
  if (surface === "p" && action) return unavailable();
  const method = request.method;
  if (method !== (action === "unlock" ? "POST" : "GET")) return unavailable();
  const shared = await currentShare(env, id);
  if (!shared) return unavailable();

  if (action === "unlock") {
    if (
      request.headers.get("origin") !== site.viewer ||
      !shared.verifier ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      return unavailable();
    if (!(await admitUnlock(request, env, site.key, id))) return limitReached();
    const body: unknown = JSON.parse(new TextDecoder().decode(await boundedBody(request, 1024)));
    const password =
      typeof body === "object" && body && "password" in body ? body.password : undefined;
    if (typeof password !== "string" || !(await checkPassword(site.key, password, shared.verifier)))
      return error("Incorrect password.", 401);
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Set-Cookie": await guestCookie(site.key, id, shared.epoch) },
    });
  }

  const asJson = surface === "api/previews" || request.headers.get("accept") === "application/json";
  if (shared.verifier && !(await isGuest(request, site.key, id, shared.epoch))) {
    if (action === "tokens") return unavailable();
    const locked = { kind: "locked-preview" as const, id };
    return asJson ? json(locked) : serveSite(request, env, locked, site.artifacts);
  }
  const {
    revision: _revision,
    artboards,
    ...manifest
  } = previewManifest.parse(JSON.parse(shared.manifest));
  if (action === "tokens") {
    const board = artboards[0];
    if (!board.tokens) return unavailable();
    if (!(await admit(env, "artifacts", 86400, 5000))) return limitReached();
    const file = await env.PREVIEWS.get(`snapshots/${shared.snapshot_id}/${board.id}/tokens.css`);
    if (!file) return unavailable();
    return new Response(file.body, {
      headers: { ...headers, "Content-Type": "text/css; charset=utf-8" },
    });
  }
  const view = {
    kind: "page-preview" as const,
    id,
    ...manifest,
    updatedAt: shared.updated_at,
    tokensUrl: `/api/previews/${id}/tokens`,
    artboards: await Promise.all(
      artboards.map(
        async ({
          document: _document,
          stylesheet: _stylesheet,
          tokens: _tokens,
          assets: _assets,
          ...board
        }) => {
          const grant = await artifactGrant(
            site.key,
            id,
            shared.snapshot_id,
            board.id,
            shared.epoch,
          );
          return { ...board, iframeUrl: `${site.artifacts}/g/${grant}/${board.id}/index.html` };
        },
      ),
    ),
  };
  return asJson ? json(view) : serveSite(request, env, view, site.artifacts);
}
