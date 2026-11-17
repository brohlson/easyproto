import { Check, ChevronDown, File, Pencil, Plus, Settings, Trash2, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Artboard, Page } from "../shared/model";

function PageActions({
  page,
  disabled,
  canDelete,
  onRename,
  onDelete,
}: {
  page: Page;
  disabled: boolean;
  canDelete: boolean;
  onRename(): void;
  onDelete(owner: HTMLButtonElement): void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  function dismiss() {
    menu.current?.hidePopover();
    trigger.current?.focus();
  }

  function show() {
    menu.current?.showPopover();
    menu.current?.querySelector<HTMLButtonElement>("button:enabled")?.focus();
  }

  return (
    <div className="page-actions">
      <button
        ref={trigger}
        className="page-icon-button page-actions-trigger"
        type="button"
        aria-label={`Page settings for ${page.name}`}
        title={`Page settings for ${page.name}`}
        data-page-actions={page.id}
        aria-haspopup="menu"
        aria-expanded={open}
        popoverTarget={id}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          if (menu.current?.matches(":popover-open")) dismiss();
          else show();
        }}
        onKeyDown={(event) => {
          if (!["ArrowRight", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          show();
        }}
      >
        <Settings size={13} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        className="menu-panel page-actions-menu"
        role="menu"
        aria-label={`Page actions for ${page.name}`}
        onToggle={(event) => {
          if (event.target !== event.currentTarget) return;
          const open = event.newState === "open";
          setOpen(open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
            return;
          }
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          const items = Array.from(
            menu.current?.querySelectorAll<HTMLButtonElement>("button:enabled") ?? [],
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
        }}
      >
        <button
          type="button"
          role="menuitem"
          className="menu-row"
          disabled={disabled}
          onClick={() => {
            dismiss();
            onRename();
          }}
        >
          <Pencil size={14} aria-hidden="true" /> Rename
        </button>
        <button
          type="button"
          role="menuitem"
          className="menu-row"
          disabled={disabled || !canDelete}
          title={canDelete ? undefined : "Keep at least one page"}
          onClick={() => {
            dismiss();
            if (trigger.current) onDelete(trigger.current);
          }}
        >
          <Trash2 size={14} aria-hidden="true" /> Delete
        </button>
      </div>
    </div>
  );
}

export function PagePicker({
  active,
  pages,
  artboards,
  disabled,
  onSwitch,
  onCreate,
  beginRename,
  beginDelete,
}: {
  active: Page;
  pages: Page[];
  artboards: Artboard[];
  disabled: boolean;
  onSwitch(pageId: string): void;
  onCreate(name: string): Promise<boolean>;
  beginRename(pageId: string): ((name: string) => Promise<boolean>) | undefined;
  beginDelete(pageId: string): (() => Promise<boolean>) | undefined;
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
  const deletionDialog = useRef<HTMLDialogElement>(null);
  const deleteOwner = useRef<HTMLButtonElement>(null);
  const [deletion, setDeletion] = useState<{
    page: Page;
    count: number;
    save(): Promise<boolean>;
  }>();
  const [deletionError, setDeletionError] = useState("");
  const [returnFocus, setReturnFocus] = useState(false);
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
  useLayoutEffect(() => {
    if (returnFocus && !disabled) {
      trigger.current?.focus();
      setReturnFocus(false);
    }
  }, [returnFocus, disabled]);
  useEffect(() => {
    if (deletion) deletionDialog.current?.showModal();
  }, [deletion]);

  function closeDeletion() {
    deletionDialog.current?.close();
    setDeletion(undefined);
    setDeletionError("");
    if (panel.current?.matches(":popover-open")) deleteOwner.current?.focus();
    else trigger.current?.focus();
  }

  function endRename(pageId: string) {
    setRename(undefined);
    requestAnimationFrame(() => {
      if (panel.current?.matches(":popover-open"))
        panel.current.querySelector<HTMLButtonElement>(`[data-page-actions="${pageId}"]`)?.focus();
    });
  }

  function dismiss() {
    panel.current?.hidePopover();
    setReturnFocus(true);
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
          if (event.target === event.currentTarget && event.newState === "closed") {
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
                <PageActions
                  page={page}
                  disabled={disabled}
                  canDelete={pages.length > 1}
                  onRename={() => {
                    const save = beginRename(page.id);
                    if (!save) return;
                    setDraft(null);
                    setRename({ pageId: page.id, name: page.name, save });
                  }}
                  onDelete={async (owner) => {
                    const save = beginDelete(page.id);
                    if (!save) return;
                    deleteOwner.current = owner;
                    const count = artboards.filter(({ pageId }) => pageId === page.id).length;
                    if (count) {
                      setDraft(null);
                      setDeletion({ page, count, save });
                    } else if (await save()) dismiss();
                  }}
                />
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
      <dialog
        ref={deletionDialog}
        className="page-delete-dialog"
        aria-labelledby="page-delete-title"
        aria-describedby="page-delete-description"
        onCancel={(event) => {
          event.preventDefault();
          if (!disabled) closeDeletion();
        }}
      >
        {deletion && (
          <>
            <h2 id="page-delete-title">Delete “{deletion.page.name}”?</h2>
            <p id="page-delete-description">
              This also deletes its {deletion.count}{" "}
              {deletion.count === 1 ? "artboard" : "artboards"}.
              <br />
              You can undo this with ⌘Z.
            </p>
            {deletionError && <p role="alert">{deletionError}</p>}
            <div className="page-delete-actions">
              <button type="button" autoFocus disabled={disabled} onClick={closeDeletion}>
                Cancel
              </button>
              <button
                type="button"
                className="page-delete-confirm"
                disabled={disabled}
                onClick={async () => {
                  if (await deletion.save()) {
                    closeDeletion();
                    dismiss();
                  } else
                    setDeletionError(
                      "The page could not be deleted. Close this dialog and try again.",
                    );
                }}
              >
                Delete page
              </button>
            </div>
          </>
        )}
      </dialog>
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
