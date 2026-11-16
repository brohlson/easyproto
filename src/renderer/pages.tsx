import { Check, ChevronDown, File, Pencil, Plus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Page } from "../shared/model";

export function PagePicker({
  active,
  pages,
  disabled,
  onSwitch,
  onCreate,
  beginRename,
}: {
  active: Page;
  pages: Page[];
  disabled: boolean;
  onSwitch(pageId: string): void;
  onCreate(name: string): Promise<boolean>;
  beginRename(pageId: string): ((name: string) => Promise<boolean>) | undefined;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [rename, setRename] = useState<{
    pageId: string;
    name: string;
    save(name: string): Promise<boolean>;
  }>();
  const renameInput = useRef<HTMLInputElement>(null);
  const editingId = rename?.pageId;
  const adding = draft !== null;
  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);
  useLayoutEffect(() => {
    if (editingId) {
      renameInput.current?.focus();
      renameInput.current?.select();
    }
  }, [editingId]);

  function endRename(pageId: string) {
    setRename(undefined);
    requestAnimationFrame(() => {
      if (panel.current?.matches(":popover-open"))
        panel.current.querySelector<HTMLButtonElement>(`[data-rename-page="${pageId}"]`)?.focus();
    });
  }

  function dismiss() {
    panel.current?.hidePopover();
    trigger.current?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="page-trigger page-picker-trigger"
        aria-label={`Pages, current page ${active.name}`}
        title={active.name}
        popoverTarget="pages"
        disabled={disabled}
      >
        <span>{active.name}</span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      <div
        ref={panel}
        id="pages"
        popover="auto"
        className="menu-panel pages-panel"
        role="group"
        aria-label="Pages"
        onToggle={(event) => {
          if (event.newState === "closed") {
            setDraft(null);
            setRename(undefined);
          }
        }}
      >
        <div className="menu-section">
          {pages.map((page) =>
            rename?.pageId === page.id ? (
              <form
                key={page.id}
                className="page-rename"
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (!disabled) endRename(page.id);
                }}
                onSubmit={async (event) => {
                  event.preventDefault();
                  const name = rename.name.trim();
                  if (!name || disabled) return;
                  if (name === page.name || (await rename.save(name))) {
                    endRename(page.id);
                  } else {
                    const save = beginRename(page.id);
                    if (save)
                      setRename((current) =>
                        current?.pageId === page.id ? { ...current, save } : current,
                      );
                    renameInput.current?.focus();
                  }
                }}
              >
                <input
                  ref={renameInput}
                  aria-label="Rename page"
                  maxLength={100}
                  value={rename.name}
                  readOnly={disabled}
                  onChange={(event) => setRename({ ...rename, name: event.currentTarget.value })}
                />
                <button
                  className="page-icon-button"
                  type="submit"
                  aria-label="Save page name"
                  title="Save page name"
                  disabled={disabled || !rename.name.trim()}
                >
                  <Check size={14} aria-hidden="true" />
                </button>
                <button
                  className="page-icon-button"
                  type="button"
                  aria-label="Cancel rename"
                  title="Cancel rename"
                  disabled={disabled}
                  onClick={() => endRename(page.id)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </form>
            ) : (
              <div className="page-picker-row" key={page.id}>
                <button
                  type="button"
                  className="menu-row page-row page-picker-choice"
                  title={page.name}
                  aria-current={page.id === active.id ? "page" : undefined}
                  disabled={disabled}
                  onClick={() => {
                    dismiss();
                    onSwitch(page.id);
                  }}
                >
                  <span className="page-row-indicator" aria-hidden="true">
                    {page.id === active.id && <Check size={13} />}
                  </span>
                  <span>{page.name}</span>
                </button>
                <button
                  className="page-icon-button"
                  type="button"
                  aria-label={`Rename page ${page.name}`}
                  title={`Rename ${page.name}`}
                  data-rename-page={page.id}
                  disabled={disabled}
                  onClick={() => {
                    const save = beginRename(page.id);
                    if (!save) return;
                    setDraft(null);
                    setRename({ pageId: page.id, name: page.name, save });
                  }}
                >
                  <Pencil size={13} aria-hidden="true" />
                </button>
              </div>
            ),
          )}
        </div>
        <div className="menu-section">
          {adding ? (
            <form
              className="page-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const name = draft?.trim();
                if (name && !disabled && (await onCreate(name))) {
                  dismiss();
                  requestAnimationFrame(() => trigger.current?.focus());
                }
              }}
            >
              <input
                ref={input}
                aria-label="Page name"
                placeholder="Page name"
                value={draft}
                maxLength={100}
                disabled={disabled}
                required
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="page-form-actions">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setDraft(null);
                    requestAnimationFrame(() => add.current?.focus());
                  }}
                >
                  Cancel
                </button>
                <button type="submit" disabled={disabled || !draft.trim()}>
                  Create page
                </button>
              </div>
            </form>
          ) : (
            <button
              ref={add}
              type="button"
              className="menu-row page-picker-add"
              disabled={disabled}
              onClick={() => {
                setRename(undefined);
                setDraft("");
              }}
            >
              <Plus aria-hidden="true" size={13} /> Add page
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export function MoveToPage({
  pages,
  count,
  disabled,
  onMove,
}: {
  pages: Page[];
  count: number;
  disabled: boolean;
  onMove(pageId: string): void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const caption = `Move ${count} ${count === 1 ? "artboard" : "artboards"} to`;
  return (
    <>
      <button
        type="button"
        className="page-trigger move-page-trigger"
        popoverTarget="move-page"
        disabled={disabled}
      >
        <span>Move to page</span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      <div
        ref={panel}
        id="move-page"
        popover="auto"
        className="menu-panel move-pages-panel"
        role="group"
        aria-label={caption}
      >
        <div className="menu-caption">{caption}</div>
        {pages.map((page) => (
          <button
            key={page.id}
            type="button"
            className="menu-row page-row"
            title={page.name}
            disabled={disabled}
            onClick={() => {
              panel.current?.hidePopover();
              onMove(page.id);
            }}
          >
            <File aria-hidden="true" size={14} />
            <span>{page.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}
