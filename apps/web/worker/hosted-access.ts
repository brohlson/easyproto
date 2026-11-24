import { error } from "./http.ts";

const encoder = new TextEncoder();
export const uuid = /^[a-f0-9-]{36}$/;
const ownerSecret = /^[A-Za-z0-9_-]{43}$/;
export const sharePassword = /^[A-Za-z0-9_-]{22}$/;
export const hostedUploadBytes = 5 * 1024 * 1024;
export const hostedStorageBytes = 250 * 1024 * 1024;

export function isLoopback(url: URL) {
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
}

export function hostedSite(env: Env) {
  if (
    !env.VIEWER_ORIGIN?.startsWith("https://") ||
    !env.ARTIFACT_ORIGIN?.startsWith("https://") ||
    env.VIEWER_ORIGIN === env.ARTIFACT_ORIGIN ||
    !ownerSecret.test(env.SHARE_KEY ?? "")
  )
    return;
  return { viewer: env.VIEWER_ORIGIN, artifacts: env.ARTIFACT_ORIGIN, key: env.SHARE_KEY };
}

function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function key(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(secret: string, value: string) {
  return encode(
    new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(value))),
  );
}

async function verify(secret: string, value: string, signature: string) {
  if (!ownerSecret.test(signature)) return false;
  const bytes = Uint8Array.from(
    atob(signature.replaceAll("-", "+").replaceAll("_", "/") + "="),
    (part) => part.charCodeAt(0),
  );
  return crypto.subtle.verify("HMAC", await key(secret), bytes, encoder.encode(value));
}

export async function allowedHostedPublisher(request: Request, env: Env) {
  const site = hostedSite(env);
  const token = env.HOSTED_PUBLISH_TOKEN;
  const supplied = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (
    !site ||
    new URL(request.url).origin !== site.viewer ||
    !token ||
    !supplied ||
    request.headers.has("origin")
  )
    return false;
  return verify(token, "owner", await sign(supplied, "owner"));
}

export async function admit(env: Env, scope: string, seconds: number, limit: number) {
  const window = Math.floor(Date.now() / 1000 / seconds);
  return Boolean(
    await env.DB.prepare(
      "INSERT INTO hosted_limits(scope, window, hits) VALUES(?, ?, 1) ON CONFLICT(scope) DO UPDATE SET hits = CASE WHEN window = excluded.window THEN hits + 1 ELSE 1 END, window = excluded.window WHERE window < excluded.window OR (window = excluded.window AND hits < ?) RETURNING hits",
    )
      .bind(scope, window, limit)
      .first(),
  );
}

export async function reserveStorage(env: Env, bytes: number) {
  return Boolean(
    await env.DB.prepare(
      "INSERT INTO hosted_storage_budget(id, reserved_bytes) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET reserved_bytes = reserved_bytes + excluded.reserved_bytes WHERE reserved_bytes + excluded.reserved_bytes <= ? RETURNING reserved_bytes",
    )
      .bind(bytes, hostedStorageBytes)
      .first(),
  );
}

export async function savePassword(secret: string, password: string) {
  // Generated passwords already carry 128 bits of entropy. The salt also makes
  // verifiers unlinkable if an owner deliberately reuses a generated password.
  const salt = crypto.randomUUID();
  return salt + "." + (await sign(secret, `password.${salt}.${password}`));
}

export async function generatePassword(secret: string, requestId: string) {
  // A unique request ID creates a fresh password and lets its authenticated
  // publisher recover the same result without storing any plaintext password.
  return (await sign(secret, `generated-password.${requestId}`)).slice(0, 22);
}

export async function admitUnlock(request: Request, env: Env, secret: string, id: string) {
  // Bound the number of client counters for each share without storing IPs.
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const bucket = (await sign(secret, `unlock-client.${id}.${ip}`)).slice(0, 2);
  if (!(await admit(env, `unlock:${id}:${bucket}`, 300, 4))) return false;
  return admit(env, `unlock:${id}`, 300, 8);
}

export async function checkPassword(secret: string, password: string, saved: string) {
  const [salt, signature] = saved.split(".");
  return (
    sharePassword.test(password) &&
    Boolean(signature) &&
    verify(secret, `password.${salt}.${password}`, signature)
  );
}

function now() {
  return Math.floor(Date.now() / 1000);
}

export async function guestCookie(secret: string, id: string, epoch: number) {
  const expiry = now() + 3600;
  const signature = await sign(secret, `guest.${id}.${epoch}.${expiry}`);
  return `__Host-ep-${id}=${expiry}.${signature}; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Strict`;
}

export async function isGuest(request: Request, secret: string, id: string, epoch: number) {
  const name = `__Host-ep-${id}=`;
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name))
    ?.slice(name.length);
  if (!raw) return false;
  const [expiry, signature, extra] = raw.split(".");
  return (
    !extra &&
    /^\d{10}$/.test(expiry) &&
    Number(expiry) > now() &&
    Boolean(signature) &&
    verify(secret, `guest.${id}.${epoch}.${expiry}`, signature)
  );
}

export async function artifactGrant(
  secret: string,
  id: string,
  snapshot: string,
  board: string,
  epoch: number,
) {
  const scope = `${id}.${snapshot}.${epoch}.${now() + 900}`;
  return `${scope}.${await sign(secret, `board.${scope}.${board}`)}`;
}

export async function readArtifactGrant(secret: string, grant: string, board: string) {
  const [id, snapshot, epoch, expiry, signature, extra] = grant.split(".");
  if (
    extra ||
    !uuid.test(id) ||
    !uuid.test(snapshot) ||
    !uuid.test(board) ||
    !/^\d{1,12}$/.test(epoch) ||
    !/^\d{10}$/.test(expiry) ||
    Number(expiry) <= now() ||
    !signature
  )
    return;
  if (!(await verify(secret, `board.${id}.${snapshot}.${epoch}.${expiry}.${board}`, signature)))
    return;
  return { id, snapshot, epoch: Number(epoch) };
}

export function limitReached() {
  return error("Preview usage limit reached. Try again later.", 429);
}
