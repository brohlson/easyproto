import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const ownerEmail = "owner@example.test";
const revision = 7;
const boards = {
  overview: { name: "Overview", width: 1120, height: 630, x: 0, y: 25 },
  today: { name: "Today", width: 390, height: 844, x: 1230, y: 0 },
};
const assetType = {
  css: "text/css",
  js: "text/javascript",
  svg: "image/svg+xml",
  woff2: "font/woff2",
};
const contentPolicy =
  "default-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const fixturePolicy =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
const authTtl = 10 * 60 * 1000;
const sessionTtl = 60 * 60 * 1000;
const validSecret = /^[\w-]{43}$/;
const sharePath = /^\/s\/([\w-]{16})(?:\/(open|boards\/(overview|today)))?$/;

const secret = () => randomBytes(32).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const cookie = (name, value, ttl) =>
  `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttl / 1000}`;

function cookieValue(request, name) {
  const prefix = `${name}=`;
  const value = request.headers.cookie
    ?.split(/;\s*/)
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
  return value && validSecret.test(value) ? value : "";
}

function send(response, body, { status = 200, type = "text/html", policy = contentPolicy } = {}) {
  response.writeHead(status, {
    "Cache-Control": "private, no-store",
    "Content-Type": type.startsWith("text/") ? `${type}; charset=utf-8` : type,
    "Content-Security-Policy": policy,
    "Referrer-Policy": policy === fixturePolicy ? "no-referrer" : "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  });
  response.end(body);
}

function redirect(response, location) {
  response.setHeader("Location", location);
  send(response, "", { status: 303 });
}

function confirmation(action, button, details) {
  return { kind: "confirm", action, button, details };
}

function viewer({ id, scope, frame }) {
  const entries = scope === "canvas" ? Object.entries(boards) : [[scope, boards[scope]]];
  return {
    kind: "viewer",
    title: scope === "canvas" ? "Field Notes" : boards[scope].name,
    revision,
    id,
    scope,
    frame,
    boards: entries.map(([boardId, board]) => ({ id: boardId, ...board })),
  };
}

function initDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE challenges (token TEXT PRIMARY KEY, browser TEXT NOT NULL, expires INTEGER NOT NULL, consumed INTEGER);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, challenge TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL);
    CREATE TABLE shares (
      id TEXT PRIMARY KEY, token TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('canvas', 'overview', 'today')),
      frame TEXT NOT NULL CHECK (frame IN ('none', 'phone', 'laptop')),
      revoked INTEGER
    );
    CREATE TABLE grants (token TEXT PRIMARY KEY, share TEXT NOT NULL, expires INTEGER NOT NULL);
  `);
  return database;
}

function redeemOwner(database, token, browser, ownerToken, now) {
  database.exec("BEGIN");
  try {
    const result = database
      .prepare(`
      INSERT INTO sessions (token, challenge, expires)
      SELECT ?, token, ? FROM challenges
      WHERE token = ? AND browser = ? AND expires > ? AND consumed IS NULL
    `)
      .run(hash(ownerToken), now + sessionTtl, hash(token), hash(browser), now);
    if (result.changes === 1) {
      database.prepare("UPDATE challenges SET consumed = ? WHERE token = ?").run(now, hash(token));
    }
    database.exec("COMMIT");
    return result.changes === 1;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function form(request) {
  if (!request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) {
    return null;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) return null;
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export async function startWeb(port = 8787) {
  const shell = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
  const mount = '<div id="root"></div>';
  if (!shell.includes(mount)) throw new Error("Build the web app with pnpm web:build.");
  const database = initDatabase();
  const inbox = new Map();
  let origin;
  let host;

  const server = createServer(async (request, response) => {
    const page = (view, status = 200) => {
      const json = JSON.stringify(view);
      if (request.headers.accept === "application/json")
        return send(response, json, { status, type: "application/json" });
      const data = json.replaceAll("<", "\\u003c");
      const html = shell.replace(
        mount,
        () => `${mount}<script id="page-data" type="application/json">${data}</script>`,
      );
      return send(response, html, { status });
    };
    const deny = (status = 404) => page({ kind: "unavailable" }, status);
    try {
      if (request.headers.host !== host) return deny(400);
      const url = new URL(request.url, origin);
      if (url.origin !== origin) return deny(400);
      const { pathname } = url;
      const post = request.method === "POST";
      if (!post && request.method !== "GET") return deny(405);
      if (post && request.headers.origin !== origin) return deny(403);
      const fields = post ? await form(request) : null;
      if (post && !fields) return deny(400);
      const browser = cookieValue(request, "easyproto_browser");
      const owner = cookieValue(request, "easyproto_owner");
      const now = Date.now();
      const ownerSession =
        owner &&
        database
          .prepare("SELECT 1 FROM sessions WHERE token = ? AND expires > ?")
          .get(hash(owner), now);

      const asset = /^\/assets\/([\w-]+\.(js|css|svg|woff2))$/.exec(pathname);
      if (!post && asset) {
        let body;
        try {
          body = readFileSync(new URL(`../dist/assets/${asset[1]}`, import.meta.url));
        } catch (error) {
          if (error.code === "ENOENT") return deny();
          throw error;
        }
        return send(response, body, { type: assetType[asset[2]] });
      }
      if (!post && pathname === "/") return page({ kind: "landing" });
      if (!post && pathname === "/demo") {
        return ownerSession
          ? redirect(response, "/publish")
          : page({ kind: "home", email: ownerEmail });
      }
      if (post && pathname === "/auth/request") {
        for (const [id, entry] of inbox) {
          if (entry.expires <= now) inbox.delete(id);
        }
        if (inbox.size >= 100) return deny(429);
        const nonce = secret();
        const link = secret();
        const email = fields.get("email")?.trim().toLowerCase();
        if (email === ownerEmail) {
          const expires = now + authTtl;
          database
            .prepare("INSERT INTO challenges (token, browser, expires) VALUES (?, ?, ?)")
            .run(hash(link), hash(nonce), expires);
          inbox.set(hash(nonce), { link, expires });
        }
        response.setHeader("Set-Cookie", cookie("easyproto_browser", nonce, authTtl));
        return redirect(response, "/dev/inbox");
      }
      if (!post && pathname === "/dev/inbox") {
        const entry = browser && inbox.get(hash(browser));
        return page({
          kind: "inbox",
          email: ownerEmail,
          link: entry && entry.expires > now ? `/auth/continue#${entry.link}` : undefined,
        });
      }
      if (pathname === "/auth/continue") {
        if (!post)
          return page(
            confirmation(
              pathname,
              "Continue sign-in",
              "Confirm that you want to sign in to publish previews.",
            ),
          );
        const token = fields.get("secret");
        const ownerToken = secret();
        if (
          !browser ||
          !token ||
          !validSecret.test(token) ||
          !redeemOwner(database, token, browser, ownerToken, now)
        )
          return deny(401);
        inbox.delete(hash(browser));
        response.setHeader("Set-Cookie", cookie("easyproto_owner", ownerToken, sessionTtl));
        return redirect(response, "/publish");
      }
      if (pathname === "/publish" || pathname.startsWith("/publish/")) {
        if (!ownerSession) return deny(401);
        if (!post && pathname === "/publish") {
          const shares = database
            .prepare(
              "SELECT id, scope, frame FROM shares WHERE revoked IS NULL ORDER BY rowid DESC",
            )
            .all();
          return page({ kind: "publisher", revision, shares });
        }
        if (post && pathname === "/publish/create") {
          const scope = fields.get("scope");
          const frame = fields.get("frame");
          if (
            !["canvas", "overview", "today"].includes(scope) ||
            !["none", "phone", "laptop"].includes(frame) ||
            (scope === "canvas" && frame !== "none")
          )
            return deny(400);
          const id = randomBytes(12).toString("base64url");
          const linkSecret = secret();
          database
            .prepare("INSERT INTO shares (id, token, scope, frame) VALUES (?, ?, ?, ?)")
            .run(id, hash(linkSecret), scope, frame);
          const link = `${origin}/s/${id}#${linkSecret}`;
          return page({ kind: "created", link }, 201);
        }
        if (post && pathname === "/publish/revoke") {
          database
            .prepare("UPDATE shares SET revoked = ? WHERE id = ? AND revoked IS NULL")
            .run(now, fields.get("id"));
          return redirect(response, "/publish");
        }
        return deny();
      }
      const shareParts = sharePath.exec(pathname);
      if (!shareParts) return deny();
      const [, id, route, boardId] = shareParts;
      const share = database
        .prepare("SELECT * FROM shares WHERE id = ? AND revoked IS NULL")
        .get(id);
      if (!share) return deny();
      const guestCookie = `easyproto_guest_${id}`;
      if (route === "open" && post) {
        const linkSecret = fields.get("secret");
        if (!linkSecret || !validSecret.test(linkSecret) || share.token !== hash(linkSecret))
          return deny();
        const grant = secret();
        database
          .prepare("INSERT INTO grants (token, share, expires) VALUES (?, ?, ?)")
          .run(hash(grant), id, now + sessionTtl);
        response.setHeader("Set-Cookie", cookie(guestCookie, grant, sessionTtl));
        return redirect(response, `/s/${id}`);
      }
      if (post) return deny();
      const grant = cookieValue(request, guestCookie);
      const hasGrant =
        grant &&
        database
          .prepare("SELECT 1 FROM grants WHERE token = ? AND share = ? AND expires > ?")
          .get(hash(grant), id, now);
      if (!route) {
        return page(
          hasGrant
            ? viewer(share)
            : confirmation(
                `/s/${id}/open`,
                "Open preview",
                "Open a read-only Field Notes preview.",
              ),
        );
      }
      if (
        !hasGrant ||
        !Object.hasOwn(boards, boardId) ||
        (share.scope !== "canvas" && boardId !== share.scope)
      ) {
        return deny();
      }
      return send(response, readFileSync(new URL(`fixtures/${boardId}.html`, import.meta.url)), {
        policy: fixturePolicy,
      });
    } catch {
      if (!response.headersSent) deny(500);
      else response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  host = `127.0.0.1:${server.address().port}`;
  origin = `http://${host}`;
  async function close() {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    database.close();
  }
  return { origin, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await startWeb(Number(process.env.EASY_PROTO_WEB_PORT ?? 8787));
  console.log(`Easy Proto local viewer at ${app.origin}`);
}
