import { error } from "./http.ts";

type Publication = { fingerprint: string; result: string | null };

export async function claimPublication(env: Env, id: string, fingerprint: string) {
  const snapshot = crypto.randomUUID();
  const now = Date.now();
  const claim = await env.DB.prepare(
    "INSERT INTO hosted_publications(request_id, fingerprint, snapshot_id, started_at) VALUES(?, ?, ?, ?) ON CONFLICT(request_id) DO UPDATE SET snapshot_id=excluded.snapshot_id, started_at=excluded.started_at WHERE fingerprint=excluded.fingerprint AND result IS NULL AND started_at <= ? RETURNING request_id",
  )
    .bind(id, fingerprint, snapshot, now, now - 300_000)
    .first();
  if (claim) return { kind: "claimed" as const, snapshot };
  const previous = await env.DB.prepare(
    "SELECT fingerprint, result FROM hosted_publications WHERE request_id=?",
  )
    .bind(id)
    .first<Publication>();
  if (previous?.fingerprint !== fingerprint)
    return {
      kind: "rejected" as const,
      failure: error("This sync request was already used for different content.", 409),
    };
  if (previous.result)
    return {
      kind: "replayed" as const,
      result: JSON.parse(previous.result) as Record<string, unknown>,
    };
  return {
    kind: "rejected" as const,
    failure: error("This sync is still finishing. Try again shortly.", 425),
  };
}

export async function releasePublication(env: Env, id: string, snapshot: string) {
  await env.DB.prepare(
    "UPDATE hosted_publications SET started_at=0 WHERE request_id=? AND snapshot_id=? AND result IS NULL",
  )
    .bind(id, snapshot)
    .run();
}
