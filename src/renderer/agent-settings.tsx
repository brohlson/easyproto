import { ArrowLeft, ChevronRight, Plus, Sparkles, Terminal, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AgentAction, AgentKind, AgentProfile, AgentProfilesState } from "../shared/agents";
import chatGPTLogo from "./brand/chatgpt-white.svg";

export const agentKinds = [
  { kind: "codex", label: "Codex", detail: "OpenAI · ChatGPT plan", Icon: Terminal },
  { kind: "claude", label: "Claude", detail: "Anthropic · API key", Icon: Sparkles },
] as const;

export function AgentIcon({ kind, size = 15 }: { kind: AgentKind; size?: number }) {
  const Icon = kind === "codex" ? Terminal : Sparkles;
  return <Icon size={size} aria-hidden="true" />;
}

export function agentStatus(profile: AgentProfile) {
  if (profile.state === "connected") return "Connected";
  if (profile.state === "reconnect") return "Reconnect";
  return "Runtime required";
}

type Flow =
  | { step: "choose" }
  | { step: "connect"; kind: AgentKind; id?: string }
  | { step: "edit" | "welcome"; id: string };

export function AgentSettings({
  state,
  onChange,
}: {
  state: AgentProfilesState | undefined;
  onChange(state: AgentProfilesState): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const owner = useRef<HTMLElement>(null);
  const cancelRequested = useRef(false);
  const [flow, setFlow] = useState<Flow>();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const profile =
    flow && "id" in flow ? state?.profiles.find(({ id }) => id === flow.id) : undefined;
  const kind = flow?.step === "connect" ? flow.kind : profile?.kind;
  const label = kind === "codex" ? "Codex" : "Claude";
  const runtime = kind === "codex" ? state?.codexInstalled : state?.claudeInstalled;
  const title =
    flow?.step === "choose"
      ? "Add agent"
      : flow?.step === "welcome"
        ? "You’re using your ChatGPT plan"
        : flow?.step === "edit"
          ? `Edit ${label} agent`
          : profile?.kind === "claude" && profile.state !== "reconnect"
            ? "Change Anthropic API key"
            : `${profile ? "Reconnect" : "Add"} ${label}`;

  useEffect(() => {
    if (flow) {
      if (!dialog.current?.open) dialog.current?.showModal();
      dialog.current
        ?.querySelector<HTMLElement>(".agent-provider-row, input[name=agent-name], .agent-finish")
        ?.focus();
    }
  }, [flow]);

  function start(next: Flow, source: HTMLElement, initial = "") {
    owner.current = source;
    setError("");
    setName(initial);
    setKey("");
    setFlow(next);
  }

  function close() {
    dialog.current?.close();
    setFlow(undefined);
    setKey("");
    owner.current?.focus();
  }

  async function perform(action: AgentAction) {
    setSaving(true);
    setError("");
    cancelRequested.current = false;
    try {
      const next = await window.easyProto.agents(action);
      onChange(next);
      if (action.action === "connect") {
        const changed = action.id
          ? next.profiles.find(({ id }) => id === action.id)
          : next.profiles.find(({ id }) => !state?.profiles.some((entry) => entry.id === id));
        if (changed?.welcome && changed.state === "connected")
          setFlow({ step: "welcome", id: changed.id });
        else if (changed?.kind === "codex" && changed.state === "reconnect") {
          setFlow({ step: "edit", id: changed.id });
          setError("Enable ChatGPT plan usage to use this agent.");
        } else close();
      } else if (action.action === "rename" || action.action === "welcome") close();
    } catch (reason) {
      if (cancelRequested.current) close();
      else
        setError(
          reason instanceof Error
            ? reason.message.split("Error: ").at(-1) || "Could not update this agent."
            : "Could not update this agent.",
        );
    } finally {
      setSaving(false);
      if (action.action === "connect") setKey("");
    }
  }

  function cancel() {
    if (!saving) close();
    else if (flow?.step === "connect") {
      cancelRequested.current = true;
      void window.easyProto.agents({ action: "cancel" }).catch(() => undefined);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    if (flow?.step === "connect")
      void perform({
        action: "connect",
        kind: flow.kind,
        name,
        id: flow.id,
        ...(flow.kind === "claude" ? { key } : {}),
      });
    else if (flow?.step === "edit") void perform({ action: "rename", id: flow.id, name });
  }

  const isSetup = flow?.step === "connect";
  return (
    <section className="home-agents" aria-labelledby="agents-title">
      <div className="home-heading">
        <h2 id="agents-title" tabIndex={-1}>
          Agents
        </h2>
        <button
          type="button"
          className="agent-button"
          disabled={!state || Boolean(state.message)}
          onClick={(event) => start({ step: "choose" }, event.currentTarget)}
        >
          <Plus size={15} aria-hidden="true" /> Add agent
        </button>
      </div>
      {state?.message ? (
        <p role="status">{state.message}</p>
      ) : state?.profiles.length ? (
        <ul aria-label="Agent profiles">
          {state.profiles.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                disabled={entry.id === "local-demo" || entry.id === "codex-experiment"}
                onClick={(event) =>
                  start({ step: "edit", id: entry.id }, event.currentTarget, entry.name)
                }
              >
                <AgentIcon kind={entry.kind} />
                <span className="home-agent-name">{entry.name}</span>
                <span className="home-agent-kind">
                  {entry.kind === "codex" ? "Codex" : "Claude"}
                </span>
                <span className="home-agent-status">{agentStatus(entry)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No agents yet</p>
      )}
      <dialog
        ref={dialog}
        className="agent-dialog"
        aria-labelledby="agent-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          cancel();
        }}
      >
        {flow && (
          <>
            <header className="agent-dialog-heading">
              {isSetup && (
                <button
                  type="button"
                  className="agent-icon-button"
                  aria-label="Back"
                  disabled={saving}
                  onClick={() => {
                    setError("");
                    setKey("");
                    setFlow(flow.id ? { step: "edit", id: flow.id } : { step: "choose" });
                  }}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                </button>
              )}
              <h2 id="agent-dialog-title">{title}</h2>
              <button
                type="button"
                className="agent-icon-button"
                aria-label="Close agent setup"
                onClick={cancel}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            {flow.step === "choose" && (
              <div className="agent-provider-list" role="group" aria-label="Providers">
                {agentKinds.map(({ kind, label, detail, Icon }) => (
                  <button
                    key={kind}
                    type="button"
                    className="agent-provider-row"
                    onClick={() => {
                      const count =
                        state?.profiles.filter((entry) => entry.kind === kind).length ?? 0;
                      setName(count ? `${label} ${count + 1}` : label);
                      setFlow({ step: "connect", kind });
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
            {flow.step === "welcome" && (
              <div className="agent-fields">
                <p>
                  Eligible Codex requests use your ChatGPT plan. You can review usage in ChatGPT
                  settings.
                </p>
                <div className="agent-dialog-actions">
                  <button
                    type="button"
                    className="agent-button quiet"
                    disabled={saving}
                    onClick={() => void perform({ action: "usage", id: flow.id })}
                  >
                    Manage usage
                  </button>
                  <button
                    type="button"
                    className="agent-button primary agent-finish"
                    disabled={saving}
                    onClick={() => void perform({ action: "welcome", id: flow.id })}
                  >
                    Got it
                  </button>
                </div>
              </div>
            )}
            {(isSetup || flow.step === "edit") && (
              <form className="agent-fields" onSubmit={submit}>
                <label htmlFor="agent-name">Name</label>
                <input
                  id="agent-name"
                  name="agent-name"
                  value={name}
                  maxLength={42}
                  required
                  disabled={saving}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
                {isSetup ? (
                  <>
                    <div className="agent-connection">
                      <AgentIcon kind={flow.kind} />
                      <span>{flow.kind === "codex" ? "Codex" : "Claude Code"}</span>
                      <small>{runtime ? "Installed locally" : "Install to use"}</small>
                    </div>
                    {flow.kind === "claude" ? (
                      <>
                        <label htmlFor="agent-api-key">Anthropic API key</label>
                        <input
                          id="agent-api-key"
                          type="password"
                          value={key}
                          autoComplete="off"
                          required
                          disabled={saving}
                          onChange={(event) => setKey(event.currentTarget.value)}
                        />
                      </>
                    ) : (
                      <p>Use your ChatGPT plan with Codex.</p>
                    )}
                    {saving && (
                      <p role="status">
                        {flow.kind === "codex"
                          ? "Finish sign-in in your browser."
                          : "Checking your Anthropic API key…"}
                      </p>
                    )}
                  </>
                ) : (
                  profile && (
                    <>
                      <div className="agent-connection">
                        <AgentIcon kind={profile.kind} />
                        <span>
                          {profile.account ??
                            (profile.kind === "codex" ? "ChatGPT plan" : "Anthropic API key")}
                        </span>
                        <small>{agentStatus(profile)}</small>
                      </div>
                      {profile.message && <p role="status">{profile.message}</p>}
                      {profile.kind === "claude" && profile.state !== "reconnect" && (
                        <button
                          type="button"
                          className="agent-button quiet agent-usage"
                          disabled={saving}
                          onClick={() => {
                            setError("");
                            setFlow({ step: "connect", kind: profile.kind, id: profile.id });
                          }}
                        >
                          Change API key
                        </button>
                      )}
                      {profile.kind === "codex" && (
                        <button
                          type="button"
                          className="agent-button quiet agent-usage"
                          disabled={saving}
                          onClick={() => void perform({ action: "usage", id: profile.id })}
                        >
                          Manage usage
                        </button>
                      )}
                    </>
                  )
                )}
                <div className="agent-dialog-actions">
                  {!isSetup &&
                    profile &&
                    (profile.state === "reconnect" ? (
                      <button
                        type="button"
                        className="agent-button quiet leading"
                        disabled={saving}
                        onClick={() => {
                          setError("");
                          setFlow({ step: "connect", kind: profile.kind, id: profile.id });
                        }}
                      >
                        Reconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="agent-button quiet leading"
                        disabled={saving}
                        onClick={() => void perform({ action: "disconnect", id: profile.id })}
                      >
                        Disconnect
                      </button>
                    ))}
                  <button
                    type="button"
                    className="agent-button quiet"
                    disabled={saving && !isSetup}
                    onClick={cancel}
                  >
                    Cancel
                  </button>
                  {isSetup && flow.kind === "codex" ? (
                    <button
                      type="submit"
                      className="agent-button chatgpt-connect"
                      disabled={saving || !runtime || !name.trim()}
                    >
                      <img src={chatGPTLogo} alt="" /> Continue with ChatGPT
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="agent-button primary"
                      disabled={saving || !name.trim() || (isSetup && !key.trim())}
                    >
                      {isSetup ? "Connect Claude" : "Save changes"}
                    </button>
                  )}
                </div>
              </form>
            )}
            {error && (
              <p className="agent-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </dialog>
    </section>
  );
}
