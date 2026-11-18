import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { _electron as electron } from "playwright";
import { proposeProjectChange } from "../dist/codex.js";

const executable = process.env.EASY_PROTO_CHECK_CODEX_BIN;
const answer = { reply: "The project has no artboards.", operation: "reply", argumentsJson: "{}" };
const key = "easy-proto-synthetic-key";
const boardHtml = "<main><p>Draft settings</p></main>";
const boardCss = "body { background: rgb(20, 30, 40); color: white; }";
const pagesReply = [
  "### Project pages",
  "",
  "- **Page 1** is the default page.",
  "- Edit `settings.css` when you’re ready.",
  "",
  "```css",
  "body { color: black; }",
  "```",
  "",
  "| Status |",
  "| --- |",
  "| Ready |",
  "",
  "[Reference](https://example.invalid/reference) ![Sample preview](https://example.invalid/preview.png)",
  "",
  '<button data-markdown-fixture>Raw button</button><img src="https://example.invalid/raw.png">',
].join("\n");

function projectAnswer({ request, project, artboardSource }) {
  const page = project.pages.find(({ name }) => name === "Explorations");
  const board = project.artboards.find(({ name }) => name === "Settings mock");
  const change = (operation, args, reply = "Here is the proposed change.") => ({
    reply,
    operation,
    argumentsJson: JSON.stringify(args),
  });
  switch (request) {
    case "What pages are in this project?":
      return change("reply", {}, pagesReply);
    case "Create Explorations":
      return change("create_page", { name: "Explorations" });
    case "Build a settings mock":
      return change("create_artboard", {
        name: "Settings mock",
        x: 0,
        y: 0,
        width: 400,
        height: 360,
        html: boardHtml,
        css: boardCss,
      });
    case "Rename Explorations":
      return change("rename_page", { pageId: page.id, name: "Experiments" });
    case "Move Settings mock to Page 1":
      return change("move_artboards_to_page", {
        artboardIds: [board.id],
        pageId: project.pages[0].id,
      });
    case "Delete Explorations":
      return change("delete_page", { pageId: page.id });
    case "Try a forged target":
      return change("delete_page", { pageId: "d95080f1-c287-41c9-82a3-50eae9b62e10" });
    case "Overwrite source":
      return change("update_artboard", {
        artboardId: board.id,
        patch: { html: "<p>Overwrite</p>" },
      });
    case "Edit Field notes":
    case "Edit the settings mockup":
    case "Edit Field notes and Settings mock":
    case "Do not read Settings mock.":
      return change("read_artboard", { artboardId: board.id });
    case "Update the draft on settings mock.":
      return artboardSource
        ? change("update_artboard", {
            artboardId: board.id,
            patch: { html: artboardSource.html.replace("Draft settings", "Updated settings") },
          })
        : change("read_artboard", { artboardId: board.id });
    default:
      throw new Error("Unexpected fixture prompt");
  }
}

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
  "installed Codex supports project chat and reads only the uniquely named artboard when needed",
  {
    skip:
      process.platform !== "darwin" || !executable
        ? "Set EASY_PROTO_CHECK_CODEX_BIN to the qualified executable"
        : false,
    timeout: 90_000,
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
    const pageId = randomUUID();
    const input = {
      request: "Does this project have any artboards?",
      recentMessages: [],
      project: {
        name: "Fixture",
        activePageId: pageId,
        pages: [{ id: pageId, name: "Page 1" }],
        artboards: [],
      },
    };
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
        writeResponse(response, body, {
          reply: "Invalid",
          operation: "get_credentials",
          argumentsJson: "{}",
        });
      else if (requests.length === 3) notify();
      else {
        const projectInput = body.input
          .filter(({ role }) => role === "user")
          .flatMap(({ content }) => content)
          .map(({ text }) => {
            try {
              return JSON.parse(text);
            } catch {
              return undefined;
            }
          })
          .find((value) => value?.project);
        assert.ok(projectInput);
        requests.at(-1).projectInput = projectInput;
        writeResponse(response, body, projectAnswer(projectInput));
      }
    });
    assert.deepEqual(
      await proposeProjectChange(settings, input, new AbortController().signal),
      answer,
    );
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
      proposeProjectChange(settings, input, new AbortController().signal),
      /valid project response/,
    );

    const lifetime = new AbortController();
    const pending = proposeProjectChange(settings, input, lifetime.signal);
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
    let app;
    t.after(async () => {
      await app?.close();
      await rm(scratch, { recursive: true, force: true });
    });
    app = await electron.launch({
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
    const page = await app.firstWindow();
    page.setDefaultTimeout(6500);
    await page.locator("svg.ep-fold-mark path").waitFor();
    const heading = page.frameLocator('iframe[title="Field notes"]').getByRole("heading");
    await heading.waitFor();
    const button = (name) => page.getByRole("button", { name, exact: true });
    const picker = (name) => button(`Pages, current page ${name}`);
    await button("Chat").click();
    const dock = page.getByRole("region", { name: "Chat", exact: true });
    const directory = process.env.EASY_PROTO_EVIDENCE;
    async function captureAppearances(label, focus) {
      if (!directory) return;
      async function appearance(theme) {
        await button("Settings").click();
        await page
          .getByRole("group", { name: "Appearance" })
          .getByRole("button", { name: theme, exact: true })
          .click();
      }
      async function size(width, height) {
        await app.evaluate(
          ({ BrowserWindow }, size) => {
            BrowserWindow.getAllWindows()
              .find((window) => window.isVisible())
              .setSize(...size);
          },
          [width, height],
        );
        await page.waitForFunction((width) => innerWidth === width, width);
      }
      for (const theme of ["Light", "Dark"]) {
        await appearance(theme);
        for (const [width, height] of [
          [1180, 770],
          [660, 480],
        ]) {
          await size(width, height);
          await focus.focus();
          assert.equal(
            await page.evaluate(async () =>
              (await document.fonts.load("13px Inter")).some((font) => font.status === "loaded"),
            ),
            true,
          );
          await page.screenshot({
            path: join(directory, `${label}-${theme.toLowerCase()}-${width}.png`),
            animations: "disabled",
          });
        }
      }
      await size(1180, 770);
      await appearance("System");
    }
    await dock.getByRole("button", { name: "Agent: Codex · API key", exact: true }).waitFor();
    await dock.getByText("Chat asks before sharing artboard source.", { exact: false }).waitFor();
    const scene = () => page.evaluate(() => window.easyProto.getScene());
    const chat = (generation) => page.evaluate((g) => window.easyProto.getChat(g), generation);
    const send = async (prompt) => {
      await dock.getByRole("textbox", { name: "Message" }).fill(prompt);
      await button("Send").click();
      await dock.getByText(prompt, { exact: true }).last().waitFor();
    };
    const revision = async () => (await scene()).revision;
    const proposal = dock.getByRole("region", { name: "Proposed project change" });
    const apply = button("Apply change");
    const approve = async () => {
      const before = await revision();
      await apply.click();
      await button("Undo edit").waitFor();
      assert.equal(await revision(), before + 1);
    };
    const undo = async () => {
      const before = await revision();
      await button("Undo edit").click();
      await dock.getByText("Edit undone.", { exact: true }).waitFor();
      assert.equal(await revision(), before + 1);
    };
    const initial = await scene();
    const remoteRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "example.invalid") remoteRequests.push(request.url());
    });
    assert.equal(await dock.getByRole("button", { name: /attach/i }).count(), 0);
    await send("What pages are in this project?");
    const markdown = dock.locator(".chat-markdown");
    await markdown.getByRole("heading", { name: "Project pages" }).waitFor();
    assert.equal(await markdown.locator("li strong").textContent(), "Page 1");
    assert.equal(await markdown.locator("li code").textContent(), "settings.css");
    assert.equal(await markdown.locator("pre code").textContent(), "body { color: black; }\n");
    await markdown.getByRole("cell", { name: "Ready", exact: true }).waitFor();
    await markdown.getByText("Reference Sample preview", { exact: true }).waitFor();
    assert.equal(await markdown.locator("a, img, [data-markdown-fixture]").count(), 0);
    assert.deepEqual(remoteRequests, []);
    if (directory)
      await page.screenshot({
        path: join(directory, "desktop-chat-markdown.png"),
        animations: "disabled",
      });
    await captureAppearances("chat-markdown", dock.getByRole("textbox", { name: "Message" }));
    assert.equal(await revision(), initial.revision);
    assert.equal((await chat(initial.generation)).turn.phase, "answered");
    const first = requests.at(-1);
    assert.equal(first.projectInput.artboardSource, undefined);
    assert.equal(first.projectInput.project.artboards.length, 1);
    assert.deepEqual(
      first.body.tools.map(({ name }) => name),
      ["request_user_input"],
    );
    assert.equal(JSON.stringify(first.projectInput).includes(scratch), false);
    assert.equal(JSON.stringify(first.projectInput).includes(key), false);
    assert.equal(JSON.stringify(first.projectInput).includes("Make room for ideas"), false);

    await send("Create Explorations");
    await proposal.getByText("Create page “Explorations”", { exact: true }).waitFor();
    assert.equal(await revision(), initial.revision);
    await dock.locator(".chat-history").getByRole("heading", { name: "Project pages" }).waitFor();
    assert.equal(requests.at(-1).projectInput.recentMessages.at(-1).response, pagesReply);
    if (directory)
      await page.screenshot({
        path: join(directory, "desktop-chat-project-proposal.png"),
        animations: "disabled",
      });
    await approve();
    const created = (await scene()).pages.find(({ name }) => name === "Explorations");
    const { turn } = await chat(initial.generation);
    await page.evaluate(
      ({ generation, id }) => window.easyProto.decideChat(generation, id, "apply"),
      { generation: initial.generation, id: turn.id },
    );
    assert.equal(await revision(), initial.revision + 1);
    await picker("Page 1").click();
    await page
      .getByRole("group", { name: "Pages" })
      .getByRole("button", { name: "Explorations", exact: true })
      .click();
    await send("Build a settings mock");
    await proposal.getByText("Create artboard “Settings mock”", { exact: true }).waitFor();
    assert.equal(requests.at(-1).projectInput.project.activePageId, created.id);
    assert.equal(requests.at(-1).projectInput.artboardSource, undefined);
    await approve();
    const preview = page.frameLocator('iframe[title="Settings mock"]');
    await preview.getByText("Draft settings").waitFor();
    assert.equal(
      await preview.locator("body").evaluate((node) => getComputedStyle(node).backgroundColor),
      "rgb(20, 30, 40)",
    );

    await send("Rename Explorations");
    await proposal
      .getByText("Rename page “Explorations” to “Experiments”", { exact: true })
      .waitFor();
    await approve();
    await picker("Experiments").waitFor();
    await undo();
    await picker("Explorations").waitFor();

    await send("Move Settings mock to Page 1");
    await apply.waitFor();
    assert.equal(requests.at(-1).projectInput.artboardSource, undefined);
    await approve();
    assert.equal(
      (await scene()).artboards.find(({ name }) => name === "Settings mock").pageId,
      initial.defaultPageId,
    );
    await undo();
    await preview.getByText("Draft settings").waitFor();

    await send("Overwrite source");
    await dock.getByRole("alert").filter({ hasText: "needs to read that artboard" }).waitFor();
    assert.equal(await apply.count(), 0);
    await send("Try a forged target");
    await dock
      .getByRole("alert")
      .filter({ hasText: "outside this turn's project context" })
      .waitFor();
    assert.equal(await apply.count(), 0);

    for (const prompt of [
      "Edit Field notes",
      "Edit the settings mockup",
      "Edit Field notes and Settings mock",
    ]) {
      const requestCount = requests.length;
      await send(prompt);
      await page.waitForFunction(
        (value) =>
          document.querySelector(".chat-timeline > .chat-message p")?.textContent === value &&
          document
            .querySelector('.chat-timeline > [role="alert"]')
            ?.textContent.startsWith("Name one artboard"),
        prompt,
      );
      assert.equal(requests.length, requestCount + 1);
      assert.equal(requests.at(-1).projectInput.request, prompt);
      assert.equal(requests.at(-1).projectInput.artboardSource, undefined);
    }

    await page.locator(".react-flow__pane").click({ position: { x: 8, y: 8 } });
    await page.locator(".react-flow__node.selected").waitFor({ state: "hidden" });
    const sourceRequest = dock.getByRole("region", { name: "Artboard source request" });
    const refused = requests.length;
    await send("Do not read Settings mock.");
    await sourceRequest.getByText(/Settings mock on Explorations/).waitFor();
    assert.equal(requests.length, refused + 1);
    assert.equal(requests.at(-1).projectInput.artboardSource, undefined);
    await captureAppearances("chat-source", button("Allow once"));
    await button("Deny").click();
    await dock.getByText("Stopped.", { exact: true }).waitFor();
    assert.equal(requests.length, refused + 1);

    const requestCount = requests.length;
    await send("Update the draft on settings mock.");
    await sourceRequest.waitFor();
    assert.equal(requests.length, requestCount + 1);
    const sourceTurn = (await chat(initial.generation)).turn;
    await page.evaluate(
      async ({ generation, id }) => {
        await Promise.all([
          window.easyProto.decideChat(generation, id, "allow_source"),
          window.easyProto.decideChat(generation, id, "allow_source"),
        ]);
      },
      { generation: initial.generation, id: sourceTurn.id },
    );
    await apply.waitFor();
    assert.equal(requests.length, requestCount + 2);
    assert.equal(requests[requestCount].projectInput.artboardSource, undefined);
    assert.deepEqual(requests.at(-1).projectInput.artboardSource, {
      artboardId: (await scene()).artboards.find(({ name }) => name === "Settings mock").id,
      html: boardHtml,
      css: boardCss,
    });
    await approve();
    await preview.getByText("Updated settings").waitFor();

    await send("Delete Explorations");
    await apply.waitFor();
    const beforeStale = await scene();
    const staleTurn = (await chat(initial.generation)).turn;
    await page.evaluate(
      ({ generation, command }) => window.easyProto.arrangeArtboard(generation, command),
      {
        generation: initial.generation,
        command: {
          projectId: initial.projectId,
          commandId: randomUUID(),
          expectedRevision: beforeStale.revision,
          operation: "update_artboard",
          arguments: {
            artboardId: initial.artboards[0].id,
            patch: { name: "Field notes revised" },
          },
        },
      },
    );
    const stale = await page.evaluate(
      ({ generation, id }) => window.easyProto.decideChat(generation, id, "apply"),
      { generation: initial.generation, id: staleTurn.id },
    );
    assert.equal(stale.turn.phase, "stale");
    assert.equal(await revision(), beforeStale.revision + 1);
    assert.equal(
      (await scene()).pages.some(({ id }) => id === created.id),
      true,
    );

    await send("Delete Explorations");
    await proposal.getByText("Also deletes 1 artboard on this page.", { exact: true }).waitFor();
    await approve();
    assert.equal(
      (await scene()).pages.some(({ id }) => id === created.id),
      false,
    );
    assert.equal(
      (await scene()).artboards.some(({ name }) => name === "Settings mock"),
      false,
    );
    await undo();
    assert.equal(
      (await scene()).pages.some(({ id }) => id === created.id),
      true,
    );
    assert.equal(
      (await scene()).artboards.some(({ name }) => name === "Settings mock"),
      true,
    );
    const beforeHome = requests.length;
    await send("Update the draft on settings mock.");
    await sourceRequest.waitFor();
    const leaving = (await chat(initial.generation)).turn;
    await button("Easy Proto Home").click();
    await button("Project").waitFor();
    await captureAppearances("home-login", button("Log in with ChatGPT"));
    await assert.rejects(
      page.evaluate(
        ({ generation, id }) => window.easyProto.decideChat(generation, id, "allow_source"),
        {
          generation: initial.generation,
          id: leaving.id,
        },
      ),
      /project selection changed/,
    );
    assert.equal(requests.length, beforeHome + 1);
  },
);
