import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AgentProfiles } from "../dist/agents.js";

test("agent profiles migrate existing Codex sign-in and retain separate Claude connections", async () => {
  const host = randomUUID();
  let legacy = JSON.stringify({
    host,
    registration: {
      client: "oaiapp_fixture",
      identity: { subject: "fixture", email: "fixture@example.test" },
      tokens: {
        access: "synthetic-access",
        expiry: Date.now() + 3600_000,
        scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
      },
      welcomed: true,
    },
  });
  let stored;
  let failWrite = true;
  let failCleanup = true;
  const store = {
    read: async () => stored,
    legacy: async () => legacy,
    async write(value) {
      if (failWrite) throw Error("fixture write failure");
      stored = value;
    },
    async finishMigration() {
      if (failCleanup) throw Error("fixture cleanup failure");
      legacy = undefined;
    },
  };
  const options = {
    codex: process.execPath,
    claude: process.execPath,
    open: async () => assert.fail("Unexpected browser launch"),
    async request(url, { headers }) {
      assert.equal(url, "https://api.anthropic.com/v1/models?limit=100");
      const key = headers["x-api-key"];
      if (key === "fixture-invalid") return new Response(null, { status: 401 });
      return Response.json({ data: [{ id: "claude-sonnet-" + key.slice(8) }] });
    },
  };

  await assert.rejects(AgentProfiles.load(store, options), /fixture write failure/);
  assert.ok(legacy);
  failWrite = false;
  const migrated = await AgentProfiles.load(store, options);
  assert.ok(legacy);
  failCleanup = false;
  const agents = await AgentProfiles.load(store, options);
  assert.deepEqual(agents.status, migrated.status);
  const [codex] = agents.status.profiles;
  assert.equal(codex.state, "connected");
  assert.equal(codex.account, "fixture@example.test");
  assert.equal(JSON.parse(stored).host, host);
  assert.equal(legacy, undefined);

  for (const name of ["draft", "review"])
    await agents.action({ action: "connect", kind: "claude", name, key: "fixture-" + name });
  const [, draft, review] = agents.status.profiles;
  assert.notEqual(draft.id, review.id);
  assert.equal(agents.provider(draft.id).backend, "claude");
  assert.equal(agents.provider(codex.id).backend, "chatgpt");
  assert.doesNotMatch(
    JSON.stringify(agents.status),
    /synthetic-access|oaiapp_|fixture-draft|fixture-review/,
  );

  await assert.rejects(
    agents.action({
      action: "connect",
      kind: "claude",
      name: "Bad",
      key: "fixture-invalid",
      id: draft.id,
    }),
    /did not accept/,
  );
  assert.equal(agents.status.profiles[1].name, "draft");
  await agents.action({ action: "rename", id: draft.id, name: "Copywriting" });
  await agents.action({ action: "disconnect", id: draft.id });
  assert.throws(() => agents.provider(draft.id), /Reconnect/);
  assert.equal(agents.provider(review.id).backend, "claude");
  assert.doesNotMatch(stored, /fixture-draft/);

  const reopened = await AgentProfiles.load(store, options);
  assert.deepEqual(
    reopened.status.profiles.map(({ id, name, state }) => [id, name, state]),
    [
      [codex.id, "Codex", "connected"],
      [draft.id, "Copywriting", "reconnect"],
      [review.id, "review", "connected"],
    ],
  );
  await reopened.action({
    action: "connect",
    kind: "claude",
    id: draft.id,
    name: "Copywriting",
    key: "fixture-new",
  });
  assert.equal(reopened.provider(draft.id).backend, "claude");
  assert.deepEqual(
    JSON.parse(stored)
      .profiles.slice(1)
      .map(({ key }) => key),
    ["fixture-new", "fixture-review"],
  );
});

test("disconnecting a Codex profile leaves a separate grant for the same account intact", async () => {
  const host = randomUUID();
  const [first, second] = [randomUUID(), randomUUID()];
  let saved = JSON.stringify({
    version: 1,
    host,
    profiles: [first, second].map((id, index) => ({
      id,
      kind: "codex",
      name: ["Drafting", "Review"][index],
      record: JSON.stringify({
        host,
        registration: {
          client: "oaiapp_fixture_" + index,
          identity: { subject: "same-account", email: "fixture@example.test" },
          tokens: {
            access: "fixture-access-" + index,
            refresh: "fixture-refresh-" + index,
            expiry: Date.now() + 3600_000,
            scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
          },
        },
      }),
    })),
  });
  const revoked = [];
  const store = {
    read: async () => saved,
    async write(value) {
      saved = value;
    },
  };
  const options = {
    codex: process.execPath,
    open: async () => assert.fail("Unexpected browser launch"),
    async request(url, { body }) {
      if (url === "https://auth.openai.com/.well-known/openid-configuration")
        return Response.json({ revocation_endpoint: "https://auth.openai.com/revoke" });
      assert.equal(String(url), "https://auth.openai.com/revoke");
      revoked.push([body.get("client_id"), body.get("token")]);
      return new Response(null, { status: 200 });
    },
  };

  const registry = await AgentProfiles.load(store, options);
  assert.equal(registry.provider(first).backend, "chatgpt");
  assert.equal(registry.provider(second).backend, "chatgpt");
  await registry.action({ action: "disconnect", id: first });
  assert.deepEqual(revoked, [["oaiapp_fixture_0", "fixture-refresh-0"]]);
  const reopened = await AgentProfiles.load(store, options);
  assert.throws(() => reopened.provider(first), /Reconnect/);
  assert.equal(reopened.provider(second).backend, "chatgpt");
  assert.equal(reopened.status.profiles[1].account, "fixture@example.test");
  assert.doesNotMatch(saved, /fixture-refresh-0|fixture-access-0/);
});
