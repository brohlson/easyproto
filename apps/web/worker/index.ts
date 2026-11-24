import { error, json } from "./http.ts";
import { readPreview, serveArtifact } from "./previews.ts";
import { publish } from "./publisher.ts";
import { serveSite } from "./site.ts";
import { joinWaitlist } from "./waitlist.ts";

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/health" && request.method === "GET") {
    await env.DB.prepare("SELECT count(*) FROM waitlist").first();
    return json({ ready: true, service: "easy-proto-web" });
  }
  if (path === "/api/waitlist" && request.method === "POST") return joinWaitlist(request, env, url);
  if (path.startsWith("/api/local/")) return publish(request, env, url);

  const previewRoute = /^\/(?:api\/previews|p)\/([a-f0-9-]{36})$/.exec(path);
  if (previewRoute && request.method === "GET") {
    const sharedPage = await readPreview(env, previewRoute[1]);
    if (!sharedPage) return error("Preview unavailable.", 404);
    if (path.startsWith("/api/") || request.headers.get("accept") === "application/json")
      return json(sharedPage);
    return serveSite(request, env, sharedPage);
  }
  const artifact = /^\/preview-artifacts\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/(.+)$/.exec(path);
  if (artifact && (request.method === "GET" || request.method === "HEAD") && !url.search)
    return serveArtifact(request, env, url, artifact);

  if (request.method !== "GET" && request.method !== "HEAD")
    return error("Method not allowed.", 405);
  if (path === "/" && request.headers.get("accept") === "application/json")
    return json({ kind: "landing" });
  if (path.startsWith("/api/") || path.startsWith("/preview-artifacts/"))
    return error("Not found.", 404);
  return serveSite(request, env);
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
