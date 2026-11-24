import { Braces, Ellipsis, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./token-dialog.module.css";
import { copyFormats, readSharedTokens, tokenType, type SharedToken } from "./tokens";

function TokenActions({ token, notify }: { token: SharedToken; notify(message: string): void }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const formats = copyFormats(token);

  async function copy(value: string, label: string) {
    menu.current?.hidePopover();
    trigger.current?.focus();
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copied.`);
    } catch {
      notify("Couldn’t copy. Check your browser’s clipboard permissions and try again.");
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.icon}
        aria-label={`Copy options for ${token.cssName.slice(5)}`}
        aria-haspopup="menu"
        aria-expanded={expanded}
        popoverTarget={id}
      >
        <Ellipsis aria-hidden="true" size={16} />
      </button>
      <div
        id={id}
        ref={menu}
        className={styles.menu}
        popover="auto"
        role="menu"
        aria-label={`Copy options for ${token.cssName.slice(5)}`}
        onToggle={(event) => {
          const open = event.newState === "open";
          setExpanded(open);
          if (open) event.currentTarget.querySelector("button")?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            menu.current?.hidePopover();
            trigger.current?.focus();
            return;
          }
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const items = [...event.currentTarget.querySelectorAll("button")];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }}
      >
        {formats.map(({ name, value }) => (
          <button key={name} type="button" role="menuitem" onClick={() => void copy(value, name)}>
            Copy {name}
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          onClick={() =>
            void copy(
              formats.map(({ name, value }) => `${name}\n${value}`).join("\n\n"),
              "All formats",
            )
          }
        >
          Copy all formats
        </button>
      </div>
    </>
  );
}

type TokenState = { kind: "loading" | "error" } | { kind: "ready"; rows: SharedToken[] };

export function TokenDialog({ iframeUrl, tokensUrl }: { iframeUrl?: string; tokensUrl?: string }) {
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TokenState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!open || state.kind !== "loading") return;
    const controller = new AbortController();
    async function load() {
      try {
        if (!tokensUrl && !iframeUrl) {
          setState({ kind: "ready", rows: [] });
          return;
        }
        const url = tokensUrl
          ? new URL(tokensUrl, location.origin)
          : new URL("tokens.css", new URL(iframeUrl!, location.origin));
        if (url.origin !== location.origin) throw new Error("Unexpected preview origin.");
        const response = await fetch(url, { mode: "same-origin", signal: controller.signal });
        if (!response.ok && response.status !== 404) throw new Error("Could not load tokens.");
        const rows = response.ok ? readSharedTokens(await response.text()) : [];
        if (!controller.signal.aborted) setState({ kind: "ready", rows });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error" });
      }
    }
    void load();
    return () => controller.abort();
  }, [iframeUrl, tokensUrl, open, state.kind]);

  const rows =
    state.kind === "ready"
      ? state.rows.filter((row) => row.cssName.includes(query.trim().toLowerCase()))
      : [];

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        onClick={() => {
          setState({ kind: "loading" });
          setQuery("");
          setNotice("");
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <Braces size={15} aria-hidden="true" /> Tokens
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={title}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
      >
        <div className={styles.heading}>
          <h2 id={title}>Project tokens</h2>
          <button
            ref={closeButton}
            type="button"
            className={styles.icon}
            aria-label="Close tokens"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {state.kind === "loading" && (
          <p className={styles.message} role="status">
            Loading tokens…
          </p>
        )}
        {state.kind === "error" && (
          <div className={styles.message}>
            <span role="alert">Couldn’t load tokens for this preview.</span>{" "}
            <button
              type="button"
              className={styles.trigger}
              onClick={() => {
                closeButton.current?.focus();
                setState({ kind: "loading" });
              }}
            >
              Try again
            </button>
          </div>
        )}
        {state.kind === "ready" &&
          (state.rows.length ? (
            <>
              <label className={styles.search}>
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search tokens"
                  placeholder="Search tokens"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </label>
              {rows.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Type</th>
                        <th scope="col">Value</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const type = tokenType(row.resolved);
                        return (
                          <tr key={row.cssName}>
                            <th scope="row">{row.cssName.slice(5)}</th>
                            <td>{type}</td>
                            <td className={styles.value}>
                              {type === "Color" && (
                                <span
                                  className={styles.swatch}
                                  style={{ backgroundColor: row.resolved }}
                                  aria-hidden="true"
                                />
                              )}
                              {row.value}
                              {row.value !== row.resolved && (
                                <span className={styles.resolved}>{row.resolved}</span>
                              )}
                            </td>
                            <td>
                              <TokenActions token={row} notify={setNotice} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.message} role="status">
                  No matching tokens.
                </p>
              )}
            </>
          ) : (
            <p className={styles.message} role="status">
              This preview has no project tokens.
            </p>
          ))}
        <p className={styles.notice} role="status">
          {notice}
        </p>
      </dialog>
    </>
  );
}
