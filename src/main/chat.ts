import { randomUUID } from "node:crypto";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import type { ChatDecision, ChatMessage, ChatRequest, ChatState, ChatTurn } from "../shared/chat";
import { source } from "../shared/model";
import { ProjectError, type Project } from "./project";

function headlineIn(html: string) {
  const tree = parse(html, { sourceCodeLocationInfo: true });
  const pending: DefaultTreeAdapterTypes.Node[] = [tree];
  while (pending.length) {
    const node = pending.pop()!;
    if ("tagName" in node && (node.tagName === "h1" || node.tagName === "h2")) {
      const location = node.sourceCodeLocation;
      const unsupported = () =>
        new Error("Chat can edit headings with plain text and line breaks only.");
      if (!location?.startTag || !location.endTag) throw unsupported();
      let offset = location.startTag.endOffset;
      const words: string[] = [];
      for (const child of node.childNodes) {
        const range = child.sourceCodeLocation;
        if (!range || range.startOffset !== offset) throw unsupported();
        const raw = html.slice(range.startOffset, range.endOffset);
        if ("value" in child && !raw.includes("<")) words.push(child.value);
        else if ("tagName" in child && child.tagName === "br" && /^<br\s*\/?>$/i.test(raw))
          words.push(" ");
        else throw unsupported();
        offset = range.endOffset;
      }
      if (offset !== location.endTag.startOffset) throw unsupported();
      const before = words.join("").replace(/\s+/g, " ").trim();
      return {
        before: before.length > 160 ? before.slice(0, 159) + "…" : before,
        from: location.startTag.endOffset,
        to: location.endTag.startOffset,
      };
    }
    if ("childNodes" in node)
      for (let index = node.childNodes.length - 1; index >= 0; index--)
        pending.push(node.childNodes[index]);
  }
  throw new Error("Attach an artboard with a heading to edit.");
}

function demoHeadline(prompt: string) {
  const request = /^(?:change|rename|set|update) (?:the )?(?:headline|heading) to\s+(.+)$/iu.exec(
    prompt,
  );
  let after = request?.[1].trim() ?? "";
  const quoted = after.replace(/[.!?]$/, "").trim();
  for (const [left, right] of [
    ["“", "”"],
    ['"', '"'],
    ["‘", "’"],
    ["'", "'"],
  ]) {
    if (quoted.startsWith(left) && quoted.endsWith(right)) {
      after = quoted.slice(1, -1).trim();
      break;
    }
  }
  if (!after || after.length > 160)
    throw new Error("For this demo, try “Change the headline to Make room for ideas.”");
  return after;
}

function draftHeadline(
  content: { html: string; css: string },
  heading: ReturnType<typeof headlineIn>,
  after: string,
) {
  const escaped = after.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const html = content.html.slice(0, heading.from) + escaped + content.html.slice(heading.to);
  if (!source.safeParse({ ...content, html }).success)
    throw new Error("The proposed HTML is too large or contains invalid text.");
  return { before: heading.before, after, html };
}

const demoResponse = "I prepared a headline change. Review it before applying.";
const batchLength = 9;

export type ChatProvider = {
  backend: "codex" | "chatgpt" | "claude";
  run(
    input: { headline: string; request: string },
    signal: AbortSignal,
  ): Promise<{ headline: string; reply: string }>;
};

export type ChatMemory = { agentId?: string; history: Map<string, ChatMessage[]> };

export class ProjectChat {
  #state: ChatState;
  #running?: AbortController;
  #timer?: NodeJS.Timeout;
  #pending?: { artboardId: string; html: string; before: string; after: string };

  constructor(
    private readonly project: Project,
    private readonly signal: AbortSignal,
    private readonly publish: (state: ChatState) => void,
    private readonly documentChanged: () => void,
    private readonly memory: ChatMemory,
    private readonly provider: (id: string) => ChatProvider | undefined,
    private readonly defaultAgent?: string,
  ) {
    const agentId = memory.agentId ?? defaultAgent;
    this.#state = {
      sequence: 0,
      backend: "demo",
      agentId,
      history: memory.history.get(agentId ?? "") ?? [],
    };
    signal.addEventListener(
      "abort",
      () => {
        this.#archive();
        this.#cancel();
      },
      { once: true },
    );
  }

  get state(): ChatState {
    return this.#state;
  }

  #archive() {
    const { agentId, turn } = this.#state;
    if (!agentId || !turn) return;
    const { id, prompt, response, artboardName } = turn;
    const existing = this.memory.history.get(agentId) ?? [];
    if (existing.at(-1)?.id !== id)
      this.memory.history.set(
        agentId,
        [...existing, { id, prompt, response, artboardName }].slice(-12),
      );
  }

  #assertIdle() {
    const phase = this.#state.turn?.phase;
    if (phase === "streaming" || phase === "proposal" || phase === "applying")
      throw new Error("Finish this turn before switching agents or starting another.");
  }

  select(agentId: string) {
    if (this.signal.aborted) throw new Error("The project selection changed.");
    if (agentId === this.#state.agentId) return this.state;
    this.#assertIdle();
    const provider = this.provider(agentId);
    this.#archive();
    this.#cancel();
    this.memory.agentId = agentId;
    this.#state = {
      sequence: this.#state.sequence + 1,
      agentId,
      backend: provider?.backend ?? "demo",
      history: this.memory.history.get(agentId) ?? [],
    };
    this.publish(this.#state);
    return this.state;
  }

  #cancel() {
    clearTimeout(this.#timer);
    this.#running?.abort();
    this.#running = undefined;
    this.#pending = undefined;
  }

  #send(turn: ChatTurn) {
    if (this.signal.aborted) return;
    this.#state = { ...this.#state, sequence: this.#state.sequence + 1, turn };
    this.publish(this.#state);
  }

  start({ artboardId, expectedRevision, prompt }: ChatRequest) {
    if (this.signal.aborted) throw new Error("The project selection changed.");
    this.#assertIdle();
    const agentId = this.#state.agentId;
    if (!agentId) throw new Error("Choose an agent before sending a message.");
    const snapshot = this.project.snapshot;
    if (snapshot.manifest.revision !== expectedRevision)
      throw new Error("The project changed. Try sending again with its current revision.");
    const board = snapshot.manifest.artboards.find(({ id }) => id === artboardId);
    const content = snapshot.sources.get(artboardId);
    if (!board || !content) throw new Error("The attached artboard is no longer in this project.");
    const heading = headlineIn(content.html);
    const provider = this.provider(agentId);
    if (!provider)
      this.#pending = { artboardId, ...draftHeadline(content, heading, demoHeadline(prompt)) };
    const turn: ChatTurn = {
      id: randomUUID(),
      artboardName: board.name,
      baseRevision: expectedRevision,
      prompt,
      response: "",
      phase: "streaming",
    };
    this.#archive();
    this.#state = {
      ...this.#state,
      backend: provider?.backend ?? "demo",
      history: this.memory.history.get(agentId) ?? [],
    };
    this.#send(turn);
    if (provider) {
      const running = new AbortController();
      this.#running = running;
      void this.#runAgent(provider, running, turn, artboardId, content, heading);
    } else {
      this.#schedule(turn, batchLength);
    }
    return this.state;
  }

  async #runAgent(
    provider: ChatProvider,
    running: AbortController,
    turn: ChatTurn,
    artboardId: string,
    content: { html: string; css: string },
    heading: ReturnType<typeof headlineIn>,
  ) {
    try {
      const result = await provider.run(
        { headline: heading.before, request: turn.prompt },
        running.signal,
      );
      if (this.#running !== running) return;
      const { html, before, after } = draftHeadline(content, heading, result.headline);
      this.#pending = { artboardId, html, before, after };
      this.#send({
        ...turn,
        response: result.reply,
        phase: "proposal",
        proposal: { before, after },
      });
    } catch (error) {
      if (this.#running !== running) return;
      const message =
        error instanceof Error && error.name === "Error" && !("code" in error)
          ? error.message
          : "The agent could not finish this turn. Check its connection on Home.";
      this.#send({ ...turn, phase: "failed", error: message });
    } finally {
      if (this.#running === running) this.#running = undefined;
    }
  }

  #schedule(turn: ChatTurn, length: number) {
    this.#timer = setTimeout(() => {
      if (!this.#pending || this.signal.aborted) return;
      if (length >= demoResponse.length) {
        const { before, after } = this.#pending;
        this.#send({
          ...turn,
          response: demoResponse,
          phase: "proposal",
          proposal: { before, after },
        });
      } else {
        this.#send({ ...turn, response: demoResponse.slice(0, length) });
        this.#schedule(turn, length + batchLength);
      }
    }, 165);
    this.#timer.unref();
  }

  async decide(turnId: string, decision: ChatDecision): Promise<ChatState> {
    const turn = this.#state.turn;
    if (this.signal.aborted || !turn || turn.id !== turnId)
      throw new Error("This chat turn is no longer active.");
    if (decision === "apply" && turn.phase === "applied") return this.state;
    if (decision === "stop" && (turn.phase === "streaming" || turn.phase === "proposal")) {
      this.#cancel();
      this.#send({ ...turn, phase: "stopped" });
    } else if (decision === "discard" && turn.phase === "proposal") {
      this.#cancel();
      this.#send({ ...turn, phase: "discarded" });
    } else if (decision === "apply" && turn.phase === "proposal" && this.#pending) {
      const { artboardId, html } = this.#pending;
      this.#send({ ...turn, phase: "applying", error: undefined });
      let appliedRevision: number;
      try {
        const receipt = await this.project.execute({
          projectId: this.project.snapshot.manifest.projectId,
          commandId: turn.id,
          expectedRevision: turn.baseRevision,
          operation: "update_artboard",
          arguments: { artboardId, patch: { html } },
        });
        appliedRevision = receipt.revision;
      } catch (error) {
        if (error instanceof ProjectError && error.code === "REVISION_CONFLICT") {
          this.#cancel();
          this.#send({ ...turn, phase: "stale" });
        } else {
          this.#send({ ...turn, error: "Could not save the edit. Try Apply again." });
        }
        return this.state;
      }
      this.#cancel();
      this.#send({ ...turn, phase: "applied", appliedRevision, error: undefined });
      this.documentChanged();
    }
    return this.state;
  }
}
