import { ArrowUp, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { chatPromptLimit, type ChatDecision, type ChatState } from "../shared/chat";
import type { AgentProfile } from "../shared/agents";
import { AgentPicker } from "./agent-picker";
import { ChatMarkdown } from "./chat-markdown";
import type { Scene } from "../shared/model";

export function ChatDock({
  scene,
  pageId,
  open,
  busy,
  onClose,
  profiles,
  onManage,
  onUndo,
}: {
  scene: Scene;
  pageId: string;
  open: boolean;
  busy: boolean;
  onClose(): void;
  profiles: AgentProfile[];
  onManage(): void;
  onUndo(): Promise<boolean>;
}) {
  const [chat, setChat] = useState<ChatState>();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [undone, setUndone] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const turn = chat?.turn;
  const phase = turn?.phase;
  const blocked =
    phase === "streaming" || phase === "source" || phase === "proposal" || phase === "applying";
  const stale =
    phase === "stale" || (phase === "proposal" && scene.revision !== turn?.baseRevision);
  const agent = profiles.find(({ id }) => id === chat?.agentId);
  const connected = agent?.state === "connected";

  function receive(next: ChatState) {
    setChat((current) => (!current || next.sequence > current.sequence ? next : current));
  }

  useEffect(() => {
    let alive = true;
    const unsubscribe = window.easyProto.onChat((next) => {
      if (next.generation === scene.generation) receive(next);
    });
    window.easyProto.getChat(scene.generation).then(
      (next) => {
        if (alive) receive(next);
      },
      () => {
        if (alive) setError("Could not load chat. Reopen the project to try again.");
      },
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [scene.generation]);

  useEffect(() => {
    if (!open) return;
    const field = input.current;
    if (connected) field?.focus();
    else field?.form?.querySelector<HTMLButtonElement>(".chat-agent-trigger")?.focus();
  }, [open, connected]);

  useEffect(() => {
    const list = timeline.current;
    if (open && list && follow.current) list.scrollTop = list.scrollHeight;
  }, [open, chat]);

  async function perform(action: () => Promise<ChatState>) {
    setError("");
    setPending(true);
    try {
      receive(await action());
      return true;
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message.split("Error: ").at(-1) : undefined;
      setError(detail ?? "Could not complete the chat action.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !chat || blocked || busy || pending || !connected) return;
    follow.current = true;
    if (
      await perform(() =>
        window.easyProto.startChat(scene.generation, {
          pageId,
          expectedRevision: scene.revision,
          prompt,
        }),
      )
    ) {
      setPrompt("");
      input.current?.focus();
    }
  }

  function decide(decision: ChatDecision) {
    if (!turn || pending) return;
    void perform(() => window.easyProto.decideChat(scene.generation, turn.id, decision));
  }

  return (
    <section className="chat-dock" id="chat-dock" aria-labelledby="chat-heading" hidden={!open}>
      <header className="chat-heading">
        <h2 id="chat-heading">Chat</h2>
        <button type="button" className="chat-icon" aria-label="Close chat" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div
        className="chat-timeline"
        ref={timeline}
        onScroll={(event) => {
          const list = event.currentTarget;
          follow.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
        }}
      >
        {!turn && !chat?.history.length && (
          <p className="chat-hint">
            {agent?.id === "local-demo"
              ? "Try asking for a headline edit."
              : connected
                ? "Ask about this project, organize pages, or build an artboard."
                : "Choose an agent to start a chat."}
          </p>
        )}
        {chat?.history.map((message) => (
          <div key={message.id} className="chat-history">
            <div className="chat-message">
              <span>You</span>
              <p>{message.prompt}</p>
            </div>
            {message.response && (
              <div className="chat-response">
                <span>{agent?.name ?? "Agent"}</span>
                <ChatMarkdown text={message.response} />
              </div>
            )}
          </div>
        ))}
        {turn && (
          <>
            <div className="chat-message">
              <span>You</span>
              <p>{turn.prompt}</p>
            </div>
            {(turn.response || phase === "streaming") && (
              <div className="chat-response">
                <span>{agent?.name ?? "Agent"}</span>
                {turn.response ? <ChatMarkdown text={turn.response} /> : <p>Working…</p>}
              </div>
            )}
            {phase === "source" && turn.sourceRequest && (
              <section className="chat-proposal" aria-label="Artboard source request">
                <strong>Read artboard source?</strong>
                <p role="status">
                  OpenAI will receive the HTML and CSS for {turn.sourceRequest.artboard}
                  {turn.sourceRequest.page ? ` on ${turn.sourceRequest.page}` : ""}.
                </p>
                <div className="chat-actions">
                  <button type="button" disabled={pending} onClick={() => decide("stop")}>
                    Deny
                  </button>
                  <button
                    type="button"
                    className="chat-primary"
                    disabled={pending || busy || scene.revision !== turn.baseRevision}
                    onClick={() => decide("allow_source")}
                  >
                    Allow once
                  </button>
                </div>
              </section>
            )}
            {(phase === "proposal" || phase === "applying" || phase === "stale") &&
              (turn.proposal || turn.change) && (
                <section
                  className="chat-proposal"
                  aria-label={turn.change ? "Proposed project change" : "Proposed headline change"}
                >
                  {turn.change ? (
                    <>
                      <strong>Proposed project change</strong>
                      <p>{turn.change.summary}</p>
                      {turn.change.details && <p>{turn.change.details}</p>}
                      {(turn.change.html !== undefined || turn.change.css !== undefined) && (
                        <details className="chat-proposal-source">
                          <summary>View proposed source</summary>
                          {turn.change.html !== undefined && (
                            <pre aria-label="HTML">{turn.change.html}</pre>
                          )}
                          {turn.change.css !== undefined && (
                            <pre aria-label="CSS">{turn.change.css}</pre>
                          )}
                        </details>
                      )}
                    </>
                  ) : (
                    turn.proposal && (
                      <>
                        <strong>Proposed headline change</strong>
                        <span>
                          {turn.artboardName} · Revision {turn.baseRevision}
                        </span>
                        <dl>
                          <div>
                            <dt>Before</dt>
                            <dd>{turn.proposal.before}</dd>
                          </div>
                          <div>
                            <dt>After</dt>
                            <dd>{turn.proposal.after}</dd>
                          </div>
                        </dl>
                      </>
                    )
                  )}
                  {stale && (
                    <p role="status">
                      {phase === "stale"
                        ? "The project changed. Send your request again."
                        : "The project changed. Discard this proposal and send a new turn."}
                    </p>
                  )}
                  {turn.error && <p role="alert">{turn.error}</p>}
                  {(phase === "proposal" || phase === "applying") && (
                    <div className="chat-actions">
                      <button
                        type="button"
                        disabled={pending || phase === "applying"}
                        onClick={() => decide("discard")}
                      >
                        Discard
                      </button>
                      <button
                        type="button"
                        className="chat-primary"
                        disabled={pending || busy || stale || phase === "applying"}
                        onClick={() => decide("apply")}
                      >
                        {phase === "applying"
                          ? "Applying…"
                          : turn.change
                            ? "Apply change"
                            : "Apply edit"}
                      </button>
                    </div>
                  )}
                </section>
              )}
            {phase === "failed" && <p role="alert">{turn.error}</p>}
            {phase === "stopped" && (
              <p role="status">
                {chat?.backend === "demo" ? "Stopped. The artboard is unchanged." : "Stopped."}
              </p>
            )}
            {phase === "discarded" && <p role="status">Proposal discarded.</p>}
            {phase === "applied" && (
              <div className="chat-result">
                <p role="status">{undone === turn.id ? "Edit undone." : "Edit applied."}</p>
                {undone !== turn.id && scene.canUndo && scene.revision === turn.appliedRevision && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (await onUndo()) setUndone(turn.id);
                    }}
                  >
                    Undo edit
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <form
        className="chat-composer"
        aria-label="Chat composer"
        onSubmit={(event) => void submit(event)}
      >
        {error && (
          <p className="chat-input-error" role="alert">
            {error}
          </p>
        )}
        {connected && agent.id !== "local-demo" && (
          <p className="chat-provider-note">
            {agent.kind === "codex"
              ? "OpenAI receives your message, recent chat, and project details. Chat asks before sharing artboard source."
              : "Anthropic receives your message and the headline of the artboard you name."}
          </p>
        )}
        <div className="chat-input">
          <textarea
            ref={input}
            aria-label="Message"
            placeholder={connected ? "Ask about this project…" : "Choose an agent to chat…"}
            disabled={!connected}
            rows={2}
            value={prompt}
            maxLength={chatPromptLimit}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                !(event.metaKey || event.ctrlKey) ||
                event.nativeEvent.isComposing
              )
                return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
          <div className="chat-actions">
            <AgentPicker
              profiles={profiles}
              selected={agent}
              disabled={blocked || busy || pending}
              onPick={(id) => {
                if (id === agent?.id) return;
                void perform(() => window.easyProto.selectChatAgent(scene.generation, id)).then(
                  (picked) => {
                    if (picked) {
                      setPrompt("");
                      follow.current = true;
                    }
                  },
                );
              }}
              onManage={onManage}
            />
            {phase === "streaming" ? (
              <button
                type="button"
                className="chat-send"
                disabled={pending}
                onClick={() => decide("stop")}
              >
                <Square size={13} aria-hidden="true" /> Stop
              </button>
            ) : (
              <button
                type="submit"
                className="chat-primary chat-send"
                disabled={!chat || busy || blocked || pending || !connected || !prompt.trim()}
              >
                <ArrowUp size={14} aria-hidden="true" /> Send
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
