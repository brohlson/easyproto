import controls from "./controls.module.css";
import { useLayoutEffect, useRef, useState } from "react";

type SaveName = (value: string) => void;

export function EditableName({
  name,
  kind,
  disabled,
  begin,
}: {
  name: string;
  kind: "project" | "artboard";
  disabled: boolean;
  begin: () => SaveName | undefined;
}) {
  const [value, setValue] = useState<string | null>(null);
  const save = useRef<SaveName | undefined>(undefined);
  const restoreFocus = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (value !== null && document.activeElement !== input.current) {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    } else if (value === null && restoreFocus.current) {
      restoreFocus.current = false;
      button.current?.focus({ preventScroll: true });
    }
  }, [value !== null]);

  function start() {
    if (disabled) return;
    save.current = begin();
    if (save.current) setValue(name);
  }

  function finish(commit: boolean, focus: boolean, draft: string) {
    const handler = save.current;
    if (!handler) return;
    save.current = undefined;
    restoreFocus.current = focus;
    setValue(null);
    const next = draft.trim();
    if (commit && next && next !== name) handler(next);
  }

  return value === null ? (
    <button
      ref={button}
      type="button"
      className={`${controls.editableName} nodrag nopan`}
      data-testid="editable-name"
      data-name-kind={kind}
      aria-label={`Rename ${kind} ${name}`}
      aria-disabled={disabled}
      title={`${name} · Double-click to rename`}
      onClick={(event) => {
        if (event.detail === 0) start();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        start();
      }}
    >
      {name}
    </button>
  ) : (
    <input
      ref={input}
      className={`${controls.nameInput} nodrag nopan`}
      data-name-kind={kind}
      aria-label={`${kind === "artboard" ? "Artboard" : "Project"} name`}
      maxLength={100}
      value={value}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={(event) => finish(true, false, event.currentTarget.value)}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          finish(event.key === "Enter", true, event.currentTarget.value);
        }
      }}
    />
  );
}
