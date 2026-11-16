import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { chatPromptLimit, type ChatDecision, type ChatState } from "../shared/chat";
import type { AgentProfile } from "../shared/agents";
import { AgentPicker } from "./agent-picker";
import type { Scene } from "../shared/model";

export function ChatDock({
  scene,
  open,
  selectedId,
  busy,
  onClose,
  profiles,
  onManage,
  onUndo,
}: {
  scene: Scene;
  open: boolean;
  selectedId?: string;
  busy: boolean;
  onClose(): void;
  profiles: AgentProfile[];
  onManage(): void;
  onUndo(): Promise<boolean>;
}) {
  const [chat, setChat] = useState<ChatState>();
  const [attachment, setAttachment] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [undone, setUndone] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const turn = chat?.turn;
  const phase = turn?.phase;
  const blocked = phase === "streaming" || phase === "proposal" || phase === "applying";
  const stale =
    phase === "stale" || (phase === "proposal" && scene.revision !== turn?.baseRevision);
  const attached = scene.artboards.find(({ id }) => id === attachment);
  const selected = scene.artboards.find(({ id }) => id === selectedId);
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
    if (!attached || !prompt.trim() || !chat || blocked || busy || pending || !connected) return;
    follow.current = true;
    if (
      await perform(() =>
        window.easyProto.startChat(scene.generation, {
          artboardId: attached.id,
          expectedRevision: scene.revision,
          prompt,
        }),
      )
    ) {
      setPrompt("");
      setAttachment(undefined);
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
            {connected
              ? "Select and attach an artboard to try a headline edit."
              : "Choose an agent to start a chat."}
          </p>
        )}
        {chat?.history.map((message) => (
          <div key={message.id} className="chat-history">
            <div className="chat-message">
              <span>You · {message.artboardName}</span>
              <p>{message.prompt}</p>
            </div>
            {message.response && (
              <div className="chat-response">
                <span>{agent?.name ?? "Agent"}</span>
                <p>{message.response}</p>
              </div>
            )}
          </div>
        ))}
        {turn && (
          <>
            <div className="chat-message">
              <span>You · {turn.artboardName}</span>
              <p>{turn.prompt}</p>
            </div>
            {(turn.response || phase === "streaming") && (
              <div className="chat-response">
                <span>{agent?.name ?? "Agent"}</span>
                <p>{turn.response || "Preparing a proposal…"}</p>
              </div>
            )}
            {(phase === "proposal" || phase === "applying" || phase === "stale") &&
              turn.proposal && (
                <section className="chat-proposal" aria-label="Proposed headline change">
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
                  {stale && (
                    <p role="status">
                      {phase === "stale"
                        ? "The project changed. Attach the artboard and send a new turn."
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
                        {phase === "applying" ? "Applying…" : "Apply edit"}
                      </button>
                    </div>
                  )}
                </section>
              )}
            {phase === "failed" && <p role="alert">{turn.error}</p>}
            {phase === "stopped" && <p role="status">Stopped. The artboard is unchanged.</p>}
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
            Send shares your message and the current headline with{" "}
            {agent.kind === "codex" ? "OpenAI" : "Anthropic"}.
          </p>
        )}
        <div className="chat-input">
          <textarea
            ref={input}
            aria-label="Message"
            placeholder={connected ? "Change the headline to…" : "Choose an agent to chat…"}
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
                      setAttachment(undefined);
                      setPrompt("");
                      follow.current = true;
                    }
                  },
                );
              }}
              onManage={onManage}
            />
            <button
              type="button"
              className="chat-attach chat-icon"
              aria-label={
                attached
                  ? `Remove ${attached.name} attachment`
                  : selected
                    ? `Attach ${selected.name}`
                    : "Attach artboard"
              }
              title={
                attached
                  ? `Remove ${attached.name} attachment`
                  : selected
                    ? `Attach ${selected.name}`
                    : "Attach artboard"
              }
              aria-pressed={Boolean(attached)}
              disabled={busy || (!attached && !selected) || blocked || pending || !connected}
              onClick={() => {
                setAttachment(attached ? undefined : selected?.id);
                input.current?.focus();
              }}
            >
              <Paperclip size={15} aria-hidden="true" />
            </button>
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
                disabled={
                  !chat || busy || blocked || pending || !connected || !attached || !prompt.trim()
                }
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
