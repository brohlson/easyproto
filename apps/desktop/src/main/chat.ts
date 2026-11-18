import { randomUUID } from "node:crypto";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import type { ChatDecision, ChatMessage, ChatRequest, ChatState, ChatTurn } from "../shared/chat";
import { source, type Command } from "../shared/model";
import { ProjectError, type Project } from "./project";
import {
  namedArtboard,
  prepareProjectChange,
  projectChatInput,
  requestedSource,
  type ProjectAnswer,
  type ProjectChatInput,
} from "./project-chat";

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
  throw new Error("Choose an artboard name with an editable heading.");
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

export type ChatProvider =
  | {
      backend: "claude";
      run(
        input: { headline: string; request: string },
        signal: AbortSignal,
      ): Promise<{ headline: string; reply: string }>;
    }
  | {
      backend: "codex" | "chatgpt";
      runProject(input: ProjectChatInput, signal: AbortSignal): Promise<ProjectAnswer>;
    };

type AgentResult = {
  reply: string;
  command?: Command;
  proposal?: ChatTurn["proposal"];
  change?: ChatTurn["change"];
};

export type ChatMemory = { agentId?: string; history: Map<string, ChatMessage[]> };

export class ProjectChat {
  #state: ChatState;
  #running?: AbortController;
  #timer?: NodeJS.Timeout;
  #pending?: Command;
  #approveSource?: () => void;

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
      backend: (agentId && provider(agentId)?.backend) || "demo",
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
    const { id, prompt, response } = turn;
    const existing = this.memory.history.get(agentId) ?? [];
    if (existing.at(-1)?.id !== id)
      this.memory.history.set(agentId, [...existing, { id, prompt, response }].slice(-12));
  }

  #assertIdle() {
    const phase = this.#state.turn?.phase;
    if (phase === "streaming" || phase === "source" || phase === "proposal" || phase === "applying")
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
    this.#approveSource = undefined;
  }

  stopUnresolved() {
    const turn = this.#state.turn;
    if (!turn || !["streaming", "source", "proposal"].includes(turn.phase)) return;
    this.#cancel();
    this.#send({ ...turn, phase: "stopped", sourceRequest: undefined });
  }

  #send(turn: ChatTurn) {
    if (this.signal.aborted) return;
    this.#state = { ...this.#state, sequence: this.#state.sequence + 1, turn };
    this.publish(this.#state);
  }

  start(request: ChatRequest) {
    if (this.signal.aborted) throw new Error("The project selection changed.");
    this.#assertIdle();
    const agentId = this.#state.agentId;
    if (!agentId) throw new Error("Choose an agent before sending a message.");
    const { expectedRevision, prompt } = request;
    const snapshot = this.project.snapshot;
    if (snapshot.manifest.revision !== expectedRevision)
      throw new Error("The project changed. Try sending again with its current revision.");
    const provider = this.provider(agentId);
    const turn: ChatTurn = {
      id: randomUUID(),
      baseRevision: expectedRevision,
      prompt,
      response: "",
      phase: "streaming",
    };
    const identity = {
      projectId: snapshot.manifest.projectId,
      commandId: turn.id,
      expectedRevision,
    };
    this.#archive();
    const history = this.memory.history.get(agentId) ?? [];
    let run: ((signal: AbortSignal) => Promise<AgentResult>) | undefined;
    let demo: AgentResult | undefined;
    if (provider && "runProject" in provider) {
      const context = projectChatInput(this.project, request, history);
      run = async (signal) => {
        let input: ProjectChatInput = context;
        let result = await provider.runProject(input, signal);
        signal.throwIfAborted();
        try {
          if (result.operation === "read_artboard") {
            if (this.project.snapshot !== snapshot)
              throw new Error("The project changed. Send your request again.");
            const { board, artboardSource } = requestedSource(context, result, snapshot);
            const page = context.project.pages.find(({ id }) => id === board.pageId);
            await this.#waitForSource(turn, { artboard: board.name, page: page?.name }, signal);
            signal.throwIfAborted();
            if (this.project.snapshot !== snapshot)
              throw new Error("The project changed. Send your request again.");
            input = { ...context, artboardSource };
            result = await provider.runProject(input, signal);
            signal.throwIfAborted();
            if (result.operation === "read_artboard")
              throw new Error(
                "Chat can read one artboard per message. Send a new request for another.",
              );
          }
          return prepareProjectChange(result, input, identity);
        } catch (error) {
          if (error instanceof Error && error.name === "Error") throw error;
          throw new Error("The agent returned an invalid project change. Try asking again.");
        }
      };
    } else {
      const boards = snapshot.manifest.artboards;
      const board =
        namedArtboard(prompt, boards) ?? (!provider && boards.length === 1 ? boards[0] : undefined);
      const content = board && snapshot.sources.get(board.id);
      if (!board || !content) {
        if (provider) throw new Error("Name one artboard in your message.");
        demo = {
          reply: "Try naming an artboard and asking to change its headline.",
        };
      } else {
        turn.artboardName = board.name;
        const heading = headlineIn(content.html);
        const draft = (headline: string, reply: string): AgentResult => {
          const { html, before, after } = draftHeadline(content, heading, headline);
          return {
            reply,
            command: {
              ...identity,
              operation: "update_artboard",
              arguments: { artboardId: board.id, patch: { html } },
            },
            proposal: { before, after },
          };
        };
        if (provider)
          run = async (signal) => {
            const result = await provider.run(
              { headline: heading.before, request: prompt },
              signal,
            );
            return draft(result.headline, result.reply);
          };
        else demo = draft(demoHeadline(prompt), demoResponse);
      }
    }
    this.#state = {
      ...this.#state,
      backend: provider?.backend ?? "demo",
      history,
    };
    this.#send(turn);
    if (run) void this.#runAgent(run, turn);
    else if (demo) this.#schedule(turn, demo, batchLength);
    return this.state;
  }

  #finish(turn: ChatTurn, result: AgentResult) {
    this.#pending = result.command;
    this.#send({
      ...turn,
      response: result.reply,
      phase: result.command ? "proposal" : "answered",
      proposal: result.proposal,
      change: result.change,
    });
  }

  #waitForSource(
    turn: ChatTurn,
    sourceRequest: NonNullable<ChatTurn["sourceRequest"]>,
    signal: AbortSignal,
  ) {
    return new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      this.#approveSource = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      this.#send({ ...turn, phase: "source", sourceRequest });
    });
  }

  async #runAgent(run: (signal: AbortSignal) => Promise<AgentResult>, turn: ChatTurn) {
    const running = new AbortController();
    this.#running = running;
    try {
      const result = await run(running.signal);
      if (this.#running !== running) return;
      this.#finish(turn, result);
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

  #schedule(turn: ChatTurn, demo: AgentResult, length: number) {
    this.#timer = setTimeout(() => {
      if (this.signal.aborted) return;
      if (length >= demo.reply.length) this.#finish(turn, demo);
      else {
        this.#send({ ...turn, response: demo.reply.slice(0, length) });
        this.#schedule(turn, demo, length + batchLength);
      }
    }, 165);
    this.#timer.unref();
  }

  async decide(turnId: string, decision: ChatDecision): Promise<ChatState> {
    const turn = this.#state.turn;
    if (this.signal.aborted || !turn || turn.id !== turnId)
      throw new Error("This chat turn is no longer active.");
    if (decision === "apply" && turn.phase === "applied") return this.state;
    if (decision === "stop") {
      this.stopUnresolved();
    } else if (decision === "allow_source" && turn.phase === "source" && this.#approveSource) {
      const approve = this.#approveSource;
      this.#approveSource = undefined;
      this.#send({ ...turn, phase: "streaming", sourceRequest: undefined });
      approve();
    } else if (decision === "discard" && turn.phase === "proposal") {
      this.#cancel();
      this.#send({ ...turn, phase: "discarded" });
    } else if (decision === "apply" && turn.phase === "proposal" && this.#pending) {
      const command = this.#pending;
      this.#send({ ...turn, phase: "applying", error: undefined });
      let appliedRevision: number;
      try {
        const receipt = await this.project.execute(command);
        appliedRevision = receipt.revision;
      } catch (error) {
        if (error instanceof ProjectError && error.code === "REVISION_CONFLICT") {
          this.#cancel();
          this.#send({ ...turn, phase: "stale" });
        } else {
          this.#send({
            ...turn,
            error:
              error instanceof ProjectError && error.code !== "SAVE_FAILED"
                ? error.message
                : "Could not save the edit. Try Apply again.",
          });
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
