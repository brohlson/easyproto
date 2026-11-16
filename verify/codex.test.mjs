import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { _electron as electron } from "playwright";
import { proposeHeadline } from "../dist/codex.js";

const executable = process.env.EASY_PROTO_CHECK_CODEX_BIN;
const answer = { reply: "I drafted a shorter headline.", headline: "Find your focus." };
const key = "easy-proto-synthetic-key";

function writeResponse(response, request, result) {
  const text = JSON.stringify(result);
  const item = {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  const data = {
    id: "resp_fixture",
    object: "response",
    model: request.model,
    created_at: 1,
    status: "completed",
    output: [item],
  };
  const events = [
    { type: "response.created", response: { ...data, status: "in_progress", output: [] } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    },
    {
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: text,
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: data },
  ];
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const event of events)
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  response.end();
}

test(
  "installed Codex proposes a scoped headline and cancels an open turn",
  {
    skip:
      process.platform !== "darwin" || !executable
        ? "Set EASY_PROTO_CHECK_CODEX_BIN to the qualified executable"
        : false,
    timeout: 30_000,
  },
  async (t) => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    });
    const settings = {
      executable,
      key,
      model: "gpt-5.4-mini",
      credential: "chatgpt",
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    };
    const input = { headline: "Make room for ideas.", request: "Propose a shorter headline." };
    const requests = [];
    let notify;
    const reached = new Promise((resolve) => {
      notify = resolve;
    });
    server.on("request", async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push({ path: request.url, auth: request.headers.authorization, body });
      if (requests.length === 1) writeResponse(response, body, answer);
      else if (requests.length === 2)
        writeResponse(response, body, { reply: "Invalid", headline: 4 });
      else if (requests.length === 3) notify();
      else writeResponse(response, body, answer);
    });
    assert.deepEqual(await proposeHeadline(settings, input, new AbortController().signal), answer);
    assert.deepEqual(
      requests.map(({ path, auth }) => [path, auth]),
      [["/v1/responses", "Bearer " + key]],
    );
    const { body } = requests[0];
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.equal(
      body.input.some(({ role }) => role === "system"),
      false,
    );
    assert.equal(body.text.format.strict, true);
    const messages = body.input.filter(({ role }) => role === "user");
    const sent = messages.flatMap(({ content }) => content.map(({ text }) => text));
    assert.equal(sent.filter((text) => text === JSON.stringify(input)).length, 1);
    assert.equal(
      sent.some((text) => text.includes(process.cwd())),
      false,
    );
    assert.equal(
      sent.some((text) => text.includes(key)),
      false,
    );
    assert.deepEqual(
      body.tools.map(({ name }) => name),
      ["request_user_input"],
    );
    await assert.rejects(
      proposeHeadline(settings, input, new AbortController().signal),
      /valid headline proposal/,
    );

    const lifetime = new AbortController();
    const pending = proposeHeadline(settings, input, lifetime.signal);
    await Promise.race([
      reached,
      pending.then(() => assert.fail("The pending turn unexpectedly finished.")),
    ]);
    lifetime.abort();
    await assert.rejects(pending, /stopped/);

    const scratch = await mkdtemp(join(tmpdir(), "easy-proto-codex-desktop-"));
    const launcher = join(scratch, "codex-fixture");
    await writeFile(
      launcher,
      `#!${process.execPath}
const { spawn } = require("node:child_process");
const args = process.argv.slice(2).map((arg) =>
  arg.startsWith("model_providers.easy_proto_responses.base_url=")
    ? ${JSON.stringify("model_providers.easy_proto_responses.base_url=" + JSON.stringify(settings.baseUrl))}
    : arg
);
const child = spawn(${JSON.stringify(executable)}, args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
`,
      { mode: 0o700 },
    );
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const app = await electron.launch({
      args: [process.cwd(), "--project=" + join(scratch, "Project")],
      env: {
        ...process.env,
        EASY_PROTO_PROFILE: join(scratch, "profile"),
        EASY_PROTO_PORT: "0",
        EASY_PROTO_CODEX_BIN: launcher,
        EASY_PROTO_CODEX_API_KEY: key,
        EASY_PROTO_CODEX_MODEL: settings.model,
      },
    });
    t.after(() => app.close());
    const page = await app.firstWindow();
    await page.locator("svg.ep-fold-mark path").waitFor();
    const heading = page.frameLocator('iframe[title="Field notes"]').getByRole("heading");
    const previous = (await heading.innerText()).replace(/\s+/g, " ").trim();
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    const dock = page.getByRole("region", { name: "Chat", exact: true });
    await dock.getByRole("button", { name: "Agent: Codex · API key", exact: true }).waitFor();
    await dock
      .getByText("Send shares your message and the current headline with OpenAI.")
      .waitFor();
    await page
      .locator(".react-flow__node")
      .filter({
        has: page.getByRole("button", { name: "Rename artboard Field notes", exact: true }),
      })
      .click({ position: { x: 32, y: 32 } });
    await dock.getByRole("button", { name: "Attach Field notes", exact: true }).click();
    await dock.getByRole("textbox", { name: "Message" }).fill(input.request);
    await dock.getByRole("button", { name: "Send", exact: true }).click();
    await dock.getByRole("button", { name: "Apply edit", exact: true }).waitFor();
    assert.equal((await heading.innerText()).replace(/\s+/g, " ").trim(), previous);
    const directory = process.env.EASY_PROTO_EVIDENCE;
    if (directory)
      await page.screenshot({ path: join(directory, "desktop-codex.png"), animations: "disabled" });
    await dock.getByRole("button", { name: "Apply edit", exact: true }).click();
    await heading.filter({ hasText: answer.headline }).waitFor();
    await dock.getByRole("button", { name: "Undo edit", exact: true }).click();
    await heading.filter({ hasText: /Make room/ }).waitFor();
    assert.equal((await heading.innerText()).replace(/\s+/g, " ").trim(), previous);
    assert.equal(requests.length, 4);
  },
);
