import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { proposeClaude } from "../dist/claude.js";

const executable = process.env.EASY_PROTO_TEST_CLAUDE_BIN;

test(
  "installed Claude Code receives a synthetic headline with an empty tool set",
  {
    skip: !executable && "Set EASY_PROTO_TEST_CLAUDE_BIN to verify native Claude.",
    timeout: 35_000,
  },
  async (t) => {
    const scratch = await mkdtemp(join(tmpdir(), "easy-proto-claude-arguments-"));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const launcher = join(scratch, "claude-fixture");
    const argumentsFile = join(scratch, "arguments.json");
    await writeFile(
      launcher,
      `#!${process.execPath}
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (!args.includes("--version")) writeFileSync(${JSON.stringify(argumentsFile)}, JSON.stringify(args));
spawn(${JSON.stringify(executable)}, args, { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 1));
`,
      { mode: 0o700 },
    );
    const requests = [];
    const answer = { reply: "I prepared the edit.", headline: "Fixture headline" };
    const server = createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      requests.push({
        path: request.url,
        key: request.headers["x-api-key"] === "fixture-only",
        tools: body.tools ?? [],
        input: body.messages,
      });
      if (!request.url.startsWith("/v1/messages?")) {
        response.writeHead(404).end();
        return;
      }
      const message = {
        type: "message",
        id: "msg_fixture",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 1 },
      };
      const content = { type: "text", text: JSON.stringify(answer) };
      if (!body.stream) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ...message, content: [content], stop_reason: "end_turn" }));
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const [type, data] of [
        ["message_start", { message }],
        ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { index: 0, delta: { type: "text_delta", text: content.text } }],
        ["content_block_stop", { index: 0 }],
        [
          "message_delta",
          { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 16 } },
        ],
        ["message_stop", {}],
      ])
        response.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...data }) + "\n\n");
      response.end();
    });
    server.listen(0, "127.0.0.1");
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    await once(server, "listening");
    const result = await proposeClaude(
      { executable: launcher, key: "fixture-only", model: "claude-sonnet-4-6" },
      { headline: "Original", request: "Change the headline" },
      AbortSignal.timeout(30_000),
      "http://127.0.0.1:" + server.address().port,
    );
    assert.deepEqual(result, answer);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].key, true);
    assert.deepEqual(requests[0].tools, []);
    assert.match(JSON.stringify(requests[0].input), /Original.*Change the headline/);
    assert.doesNotMatch(await readFile(argumentsFile, "utf8"), /Original|Change the headline/);
  },
);
