import tokenStyles from "./tokens.module.css";
import { Select } from "@easy-proto/ui";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Braces, Copy, Plus, Search, Trash2, X } from "lucide-react";
import type { Scene } from "../../shared/model";
import {
  colorToHex,
  tokenByteLimit,
  tokenTypes,
  type TokenLiteral,
  type TokenRow,
  type TokenType,
  type TokenView,
} from "../../shared/token-types";

import { ToastViewport, useToast } from "../shared/toast";

type Group = Record<string, unknown>;
type Draft = { path: string; type: TokenType; text: string; existing: boolean };

function inputValue(value: TokenLiteral | string): string {
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  if ("unit" in value) return `${value.value}${value.unit}`;
  return colorToHex(value);
}

const formHint: Record<TokenType, string> = {
  color: "#3d6df2 or {color.blue}",
  dimension: "16px or {space.base}",
  number: "1 or {scale.base}",
  fontFamily: "Inter, system-ui, sans-serif",
  fontWeight: "600 or {type.weight.medium}",
  duration: "180ms or {motion.fade}",
};

function parseValue(type: TokenType, text: string) {
  const value = text.trim();
  if (/^\{[^{}]+\}$/.test(value)) return value;
  if (type === "color") {
    if (!/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value))
      throw new Error("Enter a six- or eight-digit hex color, or an alias like {color.blue}.");
    const [r, g, b, alpha] = value
      .slice(1)
      .match(/../g)!
      .map((byte) => parseInt(byte, 16) / 255);
    return { colorSpace: "srgb", components: [r, g, b], ...(alpha === undefined ? {} : { alpha }) };
  }
  if (type === "fontFamily") return value.split(",").map((name) => name.trim());
  const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|rem|ms|s)?$/i.exec(value);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    if (
      (type === "dimension" && (unit === "px" || unit === "rem")) ||
      (type === "duration" && (unit === "ms" || unit === "s"))
    )
      return { value: amount, unit };
    if ((type === "number" || type === "fontWeight") && !unit) return amount;
  }
  throw new Error(`Enter a ${type} value, for example ${formHint[type]}.`);
}

function updateDocument(snapshot: TokenView, draft: Draft, remove: boolean) {
  const parts = draft.path.trim().split(".");
  if (
    !parts.every(
      (part) =>
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part) && part !== "constructor" && part !== "prototype",
    )
  )
    throw new Error("Use dot-separated lowercase names, such as color.brand-primary.");
  const name = parts.pop()!;
  const document = JSON.parse(snapshot.document) as Group;
  let group = document;
  for (const part of parts) {
    if (!Object.hasOwn(group, part)) group[part] = {};
    const child = group[part] as Group;
    if (Object.hasOwn(child, "$value")) throw new Error(`“${part}” is already a token.`);
    group = child;
  }
  if (remove) delete group[name];
  else {
    if (!draft.existing && Object.hasOwn(group, name)) throw new Error("That name already exists.");
    const previous = group[name] as Group | undefined;
    const unchangedValue = snapshot.rows.find(
      (row) => row.path === draft.path && row.type === draft.type,
    );
    const value =
      unchangedValue && inputValue(unchangedValue.value) === draft.text
        ? unchangedValue.value
        : parseValue(draft.type, draft.text);
    group[name] = { ...previous, $type: draft.type, $value: value };
  }
  return JSON.stringify(document, null, 2);
}

const typeLabels: Record<TokenType, string> = {
  color: "Color",
  dimension: "Dimension",
  number: "Number",
  fontFamily: "Font family",
  fontWeight: "Font weight",
  duration: "Duration",
};

const typeOptions = tokenTypes.map((value) => ({ value, label: typeLabels[value] }));

function TokenEditorRow({
  draft,
  disabled,
  stale,
  error,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: Draft;
  disabled: boolean;
  stale: boolean;
  error: string;
  onChange(draft: Draft): void;
  onSave(event: FormEvent): void;
  onCancel(): void;
  onDelete(): void;
}) {
  const firstInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    firstInput.current?.focus();
    firstInput.current?.select();
  }, []);

  return (
    <tr className={tokenStyles.tokenEditRow}>
      <td colSpan={4}>
        <form
          className={tokenStyles.tokenRowEditor}
          aria-label={draft.existing ? `Edit ${draft.path}` : "New token"}
          onSubmit={onSave}
        >
          {draft.existing ? (
            <strong className={tokenStyles.tokenEditName}>{draft.path}</strong>
          ) : (
            <input
              ref={firstInput}
              aria-label="Name"
              required
              disabled={disabled}
              placeholder="color.brand-primary"
              value={draft.path}
              onChange={(event) => onChange({ ...draft, path: event.currentTarget.value })}
            />
          )}
          <Select
            label="Type"
            value={draft.type}
            options={typeOptions}
            disabled={disabled}
            onValueChange={(type) => onChange({ ...draft, type })}
          />
          <input
            ref={draft.existing ? firstInput : undefined}
            className={tokenStyles.tokenEditValue}
            aria-label="Value"
            required
            disabled={disabled}
            placeholder={formHint[draft.type]}
            value={draft.text}
            onChange={(event) => onChange({ ...draft, text: event.currentTarget.value })}
          />
          <div
            className={`${tokenStyles.tokenActions} ${tokenStyles.tokenRowActions}`}
            data-testid="token-row-actions"
          >
            {draft.existing && (
              <button
                className={tokenStyles.tokenIcon}
                type="button"
                title="Delete token"
                aria-label="Delete token"
                disabled={disabled || stale}
                onClick={onDelete}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            )}
            <button
              className={tokenStyles.tokenCancel}
              type="button"
              disabled={disabled}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className={tokenStyles.tokenPrimary}
              type="submit"
              aria-label="Save token"
              disabled={disabled || stale}
            >
              Save
            </button>
          </div>
          {error && (
            <p className={tokenStyles.tokenRowError} role="alert">
              {error}
            </p>
          )}
        </form>
      </td>
    </tr>
  );
}

export function TokenManager({ scene, disabled }: { scene: Scene; disabled: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const jsonButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<TokenView>();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [json, setJson] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const { notify, dismiss } = useToast();
  const isEditing = draft !== undefined || json !== undefined;
  const stale = !!view && scene.revision > view.revision;

  async function run(action: () => Promise<void>) {
    setError("");
    setPending(true);
    try {
      await action();
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("Error: ").at(-1) : undefined;
      setError(detail ?? "Easy Proto could not complete the token action.");
    } finally {
      setPending(false);
    }
  }

  async function refresh() {
    setView(await window.easyProto.getTokens(scene.generation));
    setDraft(undefined);
    setJson(undefined);
  }

  function open() {
    setView(undefined);
    setSearch("");
    dialog.current?.showModal();
    void run(refresh);
  }

  function restoreEditorFocus(path?: string, fromJson = false) {
    requestAnimationFrame(() => {
      const openDialog = dialog.current;
      if (!openDialog?.open) return;
      const edited =
        path &&
        openDialog.querySelector<HTMLButtonElement>(`[data-token-name="${CSS.escape(path)}"]`);
      (edited || (fromJson ? jsonButton.current : addButton.current))?.focus();
    });
  }

  async function save(document: string, path?: string) {
    if (!view) return;
    await window.easyProto.arrangeArtboard(scene.generation, {
      operation: "replace_project_tokens",
      projectId: scene.projectId,
      expectedRevision: view.revision,
      commandId: crypto.randomUUID(),
      arguments: { document },
    });
    notify("Tokens saved.", "tokens");
    await refresh();
    restoreEditorFocus(path, json !== undefined);
  }

  function edit(row: TokenRow) {
    setError("");
    setDraft({ path: row.path, type: row.type, text: inputValue(row.value), existing: true });
  }

  function saveForm(event: FormEvent) {
    event.preventDefault();
    if (!view || pending || stale) return;
    if (json !== undefined) void run(() => save(json));
    else if (draft) void run(() => save(updateDocument(view, draft, false), draft.path.trim()));
  }

  function cancelEdit() {
    setDraft(undefined);
    setJson(undefined);
    setError("");
    restoreEditorFocus(draft?.existing ? draft.path : undefined, json !== undefined);
  }

  const query = search.trim().toLowerCase();
  const rows =
    view?.rows.filter(
      ({ path, type }) =>
        (draft?.existing && draft.path === path) ||
        `${path} ${typeLabels[type]}`.toLowerCase().includes(query),
    ) ?? [];
  function renderEditor(key: string) {
    if (!draft || !view) return null;
    return (
      <TokenEditorRow
        key={key}
        draft={draft}
        disabled={pending}
        stale={stale}
        error={error}
        onChange={setDraft}
        onSave={saveForm}
        onCancel={cancelEdit}
        onDelete={() => void run(() => save(updateDocument(view, draft, true)))}
      />
    );
  }

  return (
    <>
      <button
        className={tokenStyles.tokensTrigger}
        type="button"
        ref={trigger}
        disabled={disabled}
        onClick={open}
      >
        <Braces size={15} aria-hidden="true" /> Tokens
      </button>
      <dialog
        className={tokenStyles.tokensDialog}
        data-testid="tokens-dialog"
        aria-labelledby="token-manager-title"
        ref={dialog}
        onCancel={(event) => {
          if (pending || isEditing) event.preventDefault();
          if (isEditing && !pending) cancelEdit();
        }}
        onClose={() => {
          dismiss("tokens");
          trigger.current?.focus();
        }}
      >
        <div className={tokenStyles.tokensHeading}>
          <h2 id="token-manager-title">Project tokens</h2>
          <button
            className={tokenStyles.tokenIcon}
            type="button"
            aria-label="Close tokens"
            disabled={pending}
            onClick={() => dialog.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {stale && (
          <div className={tokenStyles.tokenNotice} role="status">
            The project has changed. Reload tokens before saving.
            <button disabled={pending} type="button" onClick={() => void run(refresh)}>
              {isEditing ? "Discard draft and reload" : "Reload tokens"}
            </button>
          </div>
        )}
        {error && !draft && (
          <p className={tokenStyles.tokenError} role="alert">
            {error}
          </p>
        )}
        {!view ? (
          pending ? (
            <p className={tokenStyles.tokenEmpty} role="status">
              Loading tokens…
            </p>
          ) : (
            <button
              className={tokenStyles.tokenRetry}
              type="button"
              onClick={() => void run(refresh)}
            >
              Retry
            </button>
          )
        ) : (
          <>
            {json === undefined && (
              <div className={tokenStyles.tokensToolbar}>
                <label className={tokenStyles.tokenSearch} data-testid="token-search">
                  <Search size={15} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="Search tokens"
                    placeholder="Search tokens"
                    value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)}
                  />
                </label>
                <button
                  ref={jsonButton}
                  type="button"
                  disabled={pending || isEditing}
                  onClick={() => {
                    setError("");
                    setJson(view.document);
                  }}
                >
                  JSON…
                </button>
                <button
                  ref={addButton}
                  className={tokenStyles.tokenPrimary}
                  type="button"
                  disabled={pending || stale || isEditing}
                  onClick={() => {
                    setError("");
                    setDraft({ path: "", type: "color", text: "", existing: false });
                    dialog.current?.querySelector(`.${tokenStyles.tokenTableWrap}`)?.scrollTo(0, 0);
                  }}
                >
                  <Plus size={15} aria-hidden="true" /> Add token
                </button>
              </div>
            )}
            {json !== undefined ? (
              <form className={tokenStyles.tokenForm} onSubmit={saveForm}>
                <label>
                  Design tokens JSON
                  <textarea
                    rows={13}
                    maxLength={tokenByteLimit}
                    value={json}
                    disabled={pending}
                    onChange={(event) => setJson(event.currentTarget.value)}
                    spellCheck={false}
                  />
                </label>
                <div className={tokenStyles.tokenActions}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void run(async () => {
                        const document = await window.easyProto.importTokens(scene.generation);
                        if (document !== null) setJson(document);
                      })
                    }
                  >
                    Import JSON…
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void run(() => window.easyProto.exportTokens(scene.generation, "json"))
                    }
                  >
                    Export saved JSON…
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void run(() => window.easyProto.exportTokens(scene.generation, "css"))
                    }
                  >
                    Export CSS…
                  </button>
                  <button
                    className={tokenStyles.tokenCancel}
                    type="button"
                    disabled={pending}
                    onClick={cancelEdit}
                  >
                    Cancel
                  </button>
                  <button
                    className={tokenStyles.tokenPrimary}
                    type="submit"
                    disabled={pending || stale}
                  >
                    Save tokens
                  </button>
                </div>
              </form>
            ) : rows.length || draft ? (
              <div className={tokenStyles.tokenTableWrap}>
                <table className={tokenStyles.tokenTable}>
                  <colgroup>
                    <col className={tokenStyles.tokenColName} />
                    <col className={tokenStyles.tokenColType} />
                    <col />
                    <col className={tokenStyles.tokenColActions} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Type</th>
                      <th scope="col">Value</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft && !draft.existing && renderEditor("new")}
                    {rows.map((row) => {
                      if (draft?.existing && draft.path === row.path) return renderEditor(row.path);
                      const css = `var(${row.cssName})`;
                      const resolved = inputValue(row.resolved);
                      return (
                        <tr key={row.path}>
                          <td>
                            <button
                              className={tokenStyles.tokenName}
                              type="button"
                              disabled={pending || stale || isEditing}
                              data-token-name={row.path}
                              onClick={() => edit(row)}
                            >
                              {row.path}
                            </button>
                          </td>
                          <td>{typeLabels[row.type]}</td>
                          <td>
                            <span className={tokenStyles.tokenValue}>
                              {row.type === "color" && (
                                <span
                                  className={tokenStyles.tokenSwatch}
                                  aria-hidden="true"
                                  style={{ backgroundColor: resolved }}
                                />
                              )}
                              {inputValue(row.value)}
                              {typeof row.value === "string" && (
                                <span className={tokenStyles.tokenResolved}>{resolved}</span>
                              )}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              title={css}
                              aria-label={`Copy CSS for ${row.path}`}
                              className={tokenStyles.tokenCopy}
                              disabled={pending}
                              onClick={() =>
                                void run(async () => {
                                  await window.easyProto.copyTokenCss(scene.generation, row.path);
                                  notify("CSS copied", "tokens");
                                })
                              }
                            >
                              <Copy size={14} aria-hidden="true" /> Copy CSS
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={tokenStyles.tokenEmpty}>
                {view.rows.length ? "No matching tokens" : "No tokens yet"}
              </p>
            )}
          </>
        )}
        <ToastViewport scope="tokens" />
      </dialog>
    </>
  );
}
