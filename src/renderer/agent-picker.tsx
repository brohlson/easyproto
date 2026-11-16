import { Check, ChevronDown, Settings } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { AgentProfile } from "../shared/agents";
import { agentKinds, agentStatus } from "./agent-settings";

export function AgentPicker({
  profiles,
  selected,
  disabled,
  onPick,
  onManage,
}: {
  profiles: AgentProfile[];
  selected?: AgentProfile;
  disabled?: boolean;
  onPick(id: string): void;
  onManage(): void;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = selected?.name ?? "Choose an agent";

  function dismiss(action: () => void) {
    panel.current?.hidePopover();
    trigger.current?.focus();
    action();
  }

  function move(event: KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      panel.current?.querySelectorAll<HTMLButtonElement>("button:enabled") ?? [],
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
    event.preventDefault();
    items[next].focus();
  }

  return (
    <div className="chat-agent-picker">
      <button
        ref={trigger}
        type="button"
        className="chat-agent-trigger"
        aria-label={`Agent: ${label}`}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        popoverTarget={id}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          panel.current?.showPopover();
        }}
      >
        <span>{label}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      <div
        ref={panel}
        popover="auto"
        id={id}
        className="menu-panel chat-agent-menu"
        role="menu"
        aria-label="Agents"
        onKeyDown={move}
        onToggle={(event) => {
          const open = event.currentTarget.matches(":popover-open");
          setOpen(open);
          if (open)
            (
              panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]:enabled') ??
              panel.current?.querySelector<HTMLButtonElement>("button:enabled")
            )?.focus();
        }}
      >
        {profiles.length === 0 && <p className="menu-caption">No agents connected</p>}
        {agentKinds.map(({ kind, label }) => {
          const group = profiles.filter((profile) => profile.kind === kind);
          return (
            group.length > 0 && (
              <div key={kind} role="group" aria-label={label}>
                <div className="menu-caption" aria-hidden="true">
                  {label}
                </div>
                {group.map((profile) => {
                  const chosen = selected?.id === profile.id;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      className="menu-row"
                      role="menuitemradio"
                      aria-checked={chosen}
                      disabled={profile.state !== "connected"}
                      onClick={() => dismiss(() => onPick(profile.id))}
                    >
                      <Check
                        size={14}
                        aria-hidden="true"
                        className={chosen ? "" : "chat-check-hidden"}
                      />
                      <span className="chat-agent-name">{profile.name}</span>
                      {profile.state !== "connected" && <small>{agentStatus(profile)}</small>}
                    </button>
                  );
                })}
              </div>
            )
          );
        })}
        <div className="menu-section chat-manage-agents">
          <button
            type="button"
            className="menu-row"
            role="menuitem"
            onClick={() => dismiss(onManage)}
          >
            <Settings size={15} aria-hidden="true" /> Manage agents
          </button>
        </div>
      </div>
    </div>
  );
}
