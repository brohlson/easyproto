import { error, json } from "./http.ts";
import { readPreview, serveArtifact } from "./previews.ts";
import { publish } from "./publisher.ts";
import { serveSite } from "./site.ts";
import { joinWaitlist } from "./waitlist.ts";
import { admit, hostedSite, isLoopback, limitReached } from "./hosted-access.ts";
import { hostedArtifact, hostedPreview } from "./hosted-viewer.ts";
import { crawlFile, indexingPolicy, publicOrigin } from "./seo.ts";

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const site = hostedSite(env);
  const local = isLoopback(url) && !site;
  if (env.VIEWER_ORIGIN || env.ARTIFACT_ORIGIN) {
    if (site && url.origin === site.artifacts) return hostedArtifact(request, env, url, site);
    if (!site || url.origin !== site.viewer) return error("Not found.", 404);
  }
  if (path === "/api/health" && request.method === "GET") {
    await env.DB.prepare("SELECT count(*) FROM waitlist").first();
    return json({ ready: true, service: "easy-proto-web" });
  }
  if (path === "/api/waitlist" && request.method === "POST") {
    if (
      site &&
      request.headers.get("origin") === site.viewer &&
      !(await admit(env, "waitlist", 86400, 500))
    )
      return limitReached();
    return joinWaitlist(request, env, url);
  }
  if (path.startsWith("/api/local/"))
    return local ? publish(request, env, url) : error("Publisher unavailable.", 403);
  if (path.startsWith("/api/hosted/"))
    return site ? publish(request, env, url, true) : error("Not found.", 404);
  if (site && (path.startsWith("/p/") || path.startsWith("/api/previews/")))
    return hostedPreview(request, env, url, site);
  if (site && path.startsWith("/g/")) return error("Not found.", 404);

  const previewRoute = /^\/(?:api\/previews|p)\/([a-f0-9-]{36})$/.exec(path);
  if (local && previewRoute && request.method === "GET") {
    const sharedPage = await readPreview(env, previewRoute[1]);
    if (!sharedPage) return error("Preview unavailable.", 404);
    if (path.startsWith("/api/") || request.headers.get("accept") === "application/json")
      return json(sharedPage);
    return serveSite(request, env, sharedPage);
  }
  const artifact = /^\/preview-artifacts\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/(.+)$/.exec(path);
  if (local && artifact && (request.method === "GET" || request.method === "HEAD") && !url.search)
    return serveArtifact(request, env, url, artifact);

  if (request.method !== "GET" && request.method !== "HEAD")
    return error("Method not allowed.", 405);
  if (path === "/robots.txt" || path === "/sitemap.xml")
    return crawlFile(request, url) ?? error("Not found.", 404);
  if (path === "/index.html" && url.origin === publicOrigin) {
    const canonical = new URL(request.url);
    canonical.pathname = "/";
    return Response.redirect(canonical.href, 308);
  }
  if (path === "/" && request.headers.get("accept") === "application/json")
    return json({ kind: "landing" });
  if (path === "/" || path.startsWith("/_next/static/")) return serveSite(request, env);
  return error("Not found.", 404);
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      return indexingPolicy(new URL(request.url), await handleRequest(request, env));
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
