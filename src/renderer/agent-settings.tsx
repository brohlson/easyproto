import { Terminal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentAction, AgentProfile, AgentProfilesState } from "../shared/agents";
import chatGPTLogo from "./brand/chatgpt-white.svg";

export function agentStatus(profile: AgentProfile) {
  if (profile.state === "connected") return "Connected";
  if (profile.state === "reconnect") return "Reconnect";
  return "Runtime required";
}

export function AgentSettings({
  state,
  onChange,
  onSigningIn,
}: {
  state: AgentProfilesState | undefined;
  onChange(state: AgentProfilesState): void;
  onSigningIn(active: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const owner = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLButtonElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const cancelRequested = useRef(false);
  const loginButton = useRef<HTMLButtonElement>(null);
  const [editingId, setEditingId] = useState<string>();
  const [name, setName] = useState("");
  const [pending, setPending] = useState<AgentAction["action"]>();
  const [error, setError] = useState("");
  const profile = state?.profiles.find(({ id }) => id === editingId);
  const signingIn = pending === "connect";

  useEffect(() => {
    if (editingId && !dialog.current?.open) {
      dialog.current?.showModal();
      nameField.current?.focus();
    }
  }, [editingId]);

  useEffect(() => {
    if (pending || editingId) return;
    restoreFocus.current?.focus();
    restoreFocus.current = null;
  }, [pending, editingId]);

  function closeEditor() {
    dialog.current?.close();
    setEditingId(undefined);
    setError("");
    restoreFocus.current = owner.current;
  }

  function cancelLogin() {
    cancelRequested.current = true;
    void window.easyProto.agents({ action: "cancel" }).catch(() => undefined);
  }

  async function perform(action: AgentAction) {
    setPending(action.action);
    if (action.action === "connect") onSigningIn(true);
    setError("");
    cancelRequested.current = false;
    try {
      const next = await window.easyProto.agents(action);
      onChange(next);
      if (action.action === "rename") closeEditor();
      if (action.action === "connect") {
        const connected = action.id
          ? next.profiles.find(({ id }) => id === action.id)
          : next.profiles.find(({ id }) => !state?.profiles.some((entry) => entry.id === id));
        if (connected?.state === "reconnect") {
          setError("Allow ChatGPT plan usage in your browser to connect Codex.");
        } else if (editingId) closeEditor();
      }
    } catch (reason) {
      if (!cancelRequested.current)
        setError(
          reason instanceof Error
            ? reason.message.split("Error: ").at(-1) || "Could not update this agent."
            : "Could not update this agent.",
        );
    } finally {
      setPending(undefined);
      if (action.action === "connect") onSigningIn(false);
    }
  }

  function login(existing?: AgentProfile) {
    if (!existing) restoreFocus.current = loginButton.current;
    const names = new Set(state?.profiles.map(({ name }) => name));
    let suggested = "Codex";
    for (let suffix = 2; names.has(suggested); suffix++) suggested = `Codex ${suffix}`;
    void perform({
      action: "connect",
      kind: "codex",
      id: existing?.id,
      name: existing?.name ?? suggested,
    });
  }

  const signInMessage = signingIn && (
    <div className="agent-sign-in">
      <p role="status">Finish signing in with ChatGPT in your browser.</p>
      <button type="button" className="agent-button quiet" onClick={cancelLogin}>
        Cancel sign-in
      </button>
    </div>
  );
  const errorMessage = error && (
    <p className="agent-error" role="alert">
      {error}
    </p>
  );

  return (
    <section className="home-agents" aria-labelledby="agents-title">
      <div className="home-heading">
        <h2 id="agents-title" tabIndex={-1}>
          Agents
        </h2>
        <button
          ref={loginButton}
          type="button"
          className="agent-button chatgpt-connect"
          disabled={!state || Boolean(state.message) || Boolean(pending)}
          onClick={() => login()}
        >
          <img src={chatGPTLogo} alt="" /> Log in with ChatGPT
        </button>
      </div>
      {state?.message && <p role="status">{state.message}</p>}
      {!editingId && signInMessage}
      {!editingId && errorMessage}
      {Boolean(state?.profiles.length) && (
        <ul aria-label="Agent profiles">
          {state?.profiles.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                disabled={
                  Boolean(pending) || entry.id === "local-demo" || entry.id === "codex-experiment"
                }
                onClick={(event) => {
                  owner.current = event.currentTarget;
                  setName(entry.name);
                  setError("");
                  setEditingId(entry.id);
                }}
              >
                <Terminal size={15} aria-hidden="true" />
                <span>{entry.name}</span>
                <span className="home-agent-status">{agentStatus(entry)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <dialog
        ref={dialog}
        className="agent-dialog"
        aria-labelledby="agent-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          if (signingIn) cancelLogin();
          else if (!pending) closeEditor();
        }}
      >
        {profile && (
          <>
            <header className="agent-dialog-heading">
              <h2 id="agent-dialog-title">Edit Codex agent</h2>
              <button
                type="button"
                className="agent-icon-button"
                aria-label="Close agent settings"
                disabled={Boolean(pending)}
                onClick={closeEditor}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <form
              className="agent-fields"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim() && !pending)
                  void perform({ action: "rename", id: profile.id, name });
              }}
            >
              <label htmlFor="agent-name">Name</label>
              <input
                ref={nameField}
                id="agent-name"
                value={name}
                maxLength={42}
                required
                disabled={Boolean(pending)}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <div className="agent-connection">
                <Terminal size={15} aria-hidden="true" />
                <span>{profile.account ?? "ChatGPT plan"}</span>
                <small>{agentStatus(profile)}</small>
              </div>
              {profile.message && <p role="status">{profile.message}</p>}
              {signInMessage}
              {profile.state === "connected" && (
                <button
                  type="button"
                  className="agent-button quiet agent-usage"
                  disabled={Boolean(pending)}
                  onClick={() => void perform({ action: "usage", id: profile.id })}
                >
                  Manage usage
                </button>
              )}
              <div className="agent-dialog-actions">
                {profile.state === "reconnect" ? (
                  <button
                    type="button"
                    className="agent-button quiet leading"
                    disabled={Boolean(pending)}
                    onClick={() => login(profile)}
                  >
                    Reconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    className="agent-button quiet leading"
                    disabled={Boolean(pending)}
                    onClick={() => void perform({ action: "disconnect", id: profile.id })}
                  >
                    Disconnect
                  </button>
                )}
                <button
                  type="button"
                  className="agent-button quiet"
                  disabled={Boolean(pending)}
                  onClick={closeEditor}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="agent-button primary"
                  disabled={Boolean(pending) || !name.trim()}
                >
                  Save changes
                </button>
              </div>
            </form>
            {errorMessage}
          </>
        )}
      </dialog>
    </section>
  );
}
