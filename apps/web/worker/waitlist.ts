import { boundedBody, error, json } from "./http.ts";

export async function joinWaitlist(request: Request, env: Env, url: URL) {
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
