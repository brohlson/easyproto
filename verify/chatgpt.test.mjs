import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ChatGPTAccount } from "../dist/chatgpt.js";

const client = "oaiapp_easy_proto_fixture";
const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const plan = "openid offline_access resource.invoke chatgpt.tokens.use.direct";
const key = await generateKeyPair("RS256");

function fixture() {
  let stored;
  let auth;
  let subject = "fixture-account";
  let grant = plan;
  let revokeOkay = true;
  let gateRefresh;
  const events = [];
  const vault = {
    async load() {
      return stored;
    },
    async save(value) {
      stored = value;
    },
  };
  const request = async (input, options) => {
    const url = String(input);
    const body = options.body;
    if (url === issuer + "/.well-known/jwks.json") {
      return Response.json({
        keys: [{ ...(await exportJWK(key.publicKey)), kid: "fixture", alg: "RS256" }],
      });
    }
    if (url === issuer + "/api/accounts/oauth/token") {
      assert.equal(body.get("client_id"), client);
      assert.equal(body.get("resource"), resource);
      if (body.get("grant_type") === "authorization_code") {
        assert.equal(body.get("redirect_uri"), auth.searchParams.get("redirect_uri"));
        assert.equal(
          createHash("sha256").update(body.get("code_verifier")).digest("base64url"),
          auth.searchParams.get("code_challenge"),
        );
        events.push("exchange");
        const id_token = await new SignJWT({
          nonce: auth.searchParams.get("nonce"),
          email: "synthetic@example.test",
        })
          .setProtectedHeader({ alg: "RS256", kid: "fixture" })
          .setSubject(subject)
          .setIssuer(issuer)
          .setAudience(client)
          .setIssuedAt()
          .setExpirationTime("10m")
          .sign(key.privateKey);
        return Response.json({
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          token_type: "Bearer",
          expires_in: 1,
          scope: grant,
          id_token,
        });
      }
      assert.equal(body.get("refresh_token"), "fixture-refresh");
      assert.equal(body.get("scope"), null);
      events.push("refresh");
      await gateRefresh;
      return Response.json({
        access_token: "next-access",
        refresh_token: "next-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (url === resource + "/models") {
      assert.equal(options.headers.Authorization, "Bearer next-access");
      events.push("catalog");
      return Response.json({
        models: [
          { slug: "hidden-model", visibility: "hidden" },
          { slug: "fixture-model", visibility: "list" },
        ],
      });
    }
    if (url === issuer + "/.well-known/openid-configuration")
      return Response.json({ revocation_endpoint: issuer + "/revoke" });
    if (url === issuer + "/revoke") {
      assert.equal(body.get("client_id"), client);
      events.push("revoke:" + body.get("token"));
      return new Response(null, { status: revokeOkay ? 200 : 503 });
    }
    assert.fail("Unexpected fixture endpoint.");
  };
  return {
    vault,
    request,
    events,
    get stored() {
      return JSON.parse(stored);
    },
    options(options) {
      ({
        subject = subject,
        grant = grant,
        revokeOkay = revokeOkay,
        gateRefresh = gateRefresh,
      } = options);
    },
    async signIn(account, options = {}) {
      let replied;
      await account.signIn(async (url) => {
        auth = new URL(url);
        assert.equal(auth.origin, issuer);
        assert.equal(
          auth.searchParams.get("client_id"),
          options.reconnect ? client : "dynamic_agent_client",
        );
        assert.equal(
          auth.searchParams.get("agent_name_hint"),
          options.reconnect ? null : "Easy Proto",
        );
        assert.match(auth.searchParams.get("ext_agent_host_id"), /^urn:uuid:/);
        assert.equal(auth.searchParams.get("prompt"), options.consent ? "consent" : null);
        assert.match(auth.searchParams.get("scope"), /chatgpt.tokens.use.direct/);
        const callback = new URL(auth.searchParams.get("redirect_uri"));
        assert.equal(callback.hostname, "127.0.0.1");
        assert.equal((await fetch(callback + "?state=unrelated")).status, 400);
        assert.equal((await fetch(callback + "?state=duplicate&state=duplicate")).status, 400);
        assert.equal((await fetch(callback, { method: "POST" })).status, 400);
        callback.search = new URLSearchParams({
          state: auth.searchParams.get("state"),
          code: "fixture-code",
        });
        if (!options.reconnect) callback.searchParams.set("client_id", client);
        replied = fetch(callback).catch(() => undefined);
      });
      return replied;
    },
  };
}

test("ChatGPT sign-in binds the local callback, verifies identity, rotates credentials, and disconnects", async () => {
  const oauth = fixture();
  const account = await ChatGPTAccount.load(oauth.vault, oauth.request);
  assert.equal((await oauth.signIn(account))?.status, 200);
  assert.equal(account.status.plan, true);
  assert.equal(account.status.welcome, true);
  const host = oauth.stored.host;
  const reopened = await ChatGPTAccount.load(oauth.vault, oauth.request);
  assert.equal(reopened.status.connected, true);
  assert.doesNotMatch(JSON.stringify(reopened.status), /fixture-access|fixture-refresh|oaiapp_/);
  const signal = new AbortController().signal;
  const [a, b] = await Promise.all([
    reopened.provider(signal),
    reopened.provider(signal),
    reopened.welcomeSeen(),
  ]);
  assert.equal(a.model, "fixture-model");
  assert.deepEqual(a, b);
  assert.equal(oauth.events.filter((entry) => entry === "refresh").length, 1);
  assert.equal(oauth.stored.registration.tokens.refresh, "next-refresh");
  assert.equal(reopened.status.welcome, false);

  await reopened.signOut();
  assert.equal(reopened.status.connected, false);
  assert.equal(oauth.stored.registration.client, client);
  assert.equal(oauth.stored.registration.tokens, undefined);
  assert.equal(oauth.events.at(-1), "revoke:next-refresh");
  await assert.rejects(reopened.provider(signal), /Enable ChatGPT plan/);

  await oauth.signIn(reopened, { reconnect: true });
  assert.equal(reopened.status.welcome, false);
  assert.equal(oauth.stored.host, host);
});

test("declined plan cannot infer and a different returning identity cannot replace the connection", async () => {
  const oauth = fixture();
  oauth.options({ grant: "openid" });
  const account = await ChatGPTAccount.load(oauth.vault, oauth.request);
  await oauth.signIn(account);
  assert.equal(account.status.connected, true);
  assert.equal(account.status.plan, false);
  await assert.rejects(account.provider(new AbortController().signal), /Enable ChatGPT plan/);
  assert.deepEqual(oauth.events, ["exchange"]);
  oauth.options({ grant: plan, subject: "different-fixture-account" });
  await assert.rejects(
    oauth.signIn(account, { reconnect: true, consent: true }),
    /previously connected/,
  );
  assert.equal(account.status.plan, false);
  assert.equal(oauth.stored.registration.identity.subject, "fixture-account");
});

test("disconnect blocks an in-flight refresh and reports unconfirmed revocation", async () => {
  const oauth = fixture();
  const account = await ChatGPTAccount.load(oauth.vault, oauth.request);
  await oauth.signIn(account);
  const { promise, resolve } = Promise.withResolvers();
  oauth.options({ gateRefresh: promise, revokeOkay: false });
  const pending = assert.rejects(
    account.provider(new AbortController().signal),
    /Enable ChatGPT plan/,
  );
  const disconnected = account.signOut();
  resolve();
  await Promise.all([pending, disconnected]);
  assert.equal(oauth.events.includes("catalog"), false);
  assert.equal(oauth.events.filter((event) => event === "revoke:next-refresh").length, 2);
  assert.match(account.status.message, /disconnect any remaining ChatGPT session/);
  assert.equal(oauth.stored.registration.tokens, undefined);
});

test("cancelling while the runtime is checked leaves the browser closed", async () => {
  const oauth = fixture();
  const account = await ChatGPTAccount.load(oauth.vault, oauth.request);
  const { promise, resolve } = Promise.withResolvers();
  const signingIn = account.signIn(
    () => assert.fail("The browser was opened after cancellation."),
    () => promise,
  );
  account.cancelSignIn();
  resolve();
  await assert.rejects(signingIn, /cancelled/);
  assert.equal(account.status.pending, undefined);
  assert.equal(await oauth.vault.load(), undefined);
});
