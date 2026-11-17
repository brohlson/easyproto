import {
  Check,
  Copy,
  FolderOpen,
  House,
  Monitor,
  Moon,
  Plus,
  Settings as Cog,
  Sun,
} from "lucide-react";
import { useRef } from "react";

export type Theme = "system" | "light" | "dark";

const appearances = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export function Settings({
  theme,
  changeTheme,
  busy,
  goHome,
  choose,
  saveCopy,
}: {
  theme: Theme;
  changeTheme: (theme: Theme) => void;
  busy: boolean;
  goHome?: () => void;
  choose: (mode: "create" | "open") => void;
  saveCopy?: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  function invoke(action: () => void) {
    panel.current?.hidePopover();
    trigger.current?.focus();
    action();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="settings-button"
        aria-label="Settings"
        title="Settings"
        popoverTarget="settings"
      >
        <Cog aria-hidden="true" size={18} strokeWidth={1.75} />
      </button>
      <div
        ref={panel}
        id="settings"
        popover="auto"
        className="menu-panel settings-panel"
        role="group"
        aria-label="Settings"
      >
        <div className="menu-section" role="group" aria-label="Project actions">
          {goHome && (
            <>
              <button
                type="button"
                className="menu-row"
                disabled={busy}
                onClick={() => invoke(goHome)}
              >
                <House aria-hidden="true" size={15} /> Home
              </button>
              <button
                type="button"
                className="menu-row"
                disabled={busy}
                onClick={() => invoke(() => choose("create"))}
              >
                <Plus aria-hidden="true" size={15} /> Create project
              </button>
            </>
          )}
          <button
            type="button"
            className="menu-row"
            disabled={busy}
            onClick={() => invoke(() => choose("open"))}
          >
            <FolderOpen aria-hidden="true" size={15} /> Open project…
          </button>
          {saveCopy && (
            <button
              type="button"
              className="menu-row"
              disabled={busy}
              onClick={() => invoke(saveCopy)}
            >
              <Copy aria-hidden="true" size={15} /> Save a Copy…
            </button>
          )}
        </div>
        <div className="menu-section" role="group" aria-label="Appearance">
          <div className="menu-caption">Appearance</div>
          {appearances.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              className="menu-row appearance-row"
              aria-pressed={value === theme}
              onClick={() => invoke(() => changeTheme(value))}
            >
              <Icon aria-hidden="true" size={15} /> {label}
              {value === theme && <Check aria-hidden="true" className="menu-check" size={14} />}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
