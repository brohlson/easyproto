import previewStyles from "./web-preview.module.css";
import { useLayoutEffect, useRef, useState } from "react";
import type { WebPreviewInfo } from "@easy-proto/preview";
import type { Scene } from "../../shared/model";

export function WebPreviewDialog({
  scene,
  pageId,
  close,
}: {
  scene: Scene;
  pageId: string;
  close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const [info, setInfo] = useState<WebPreviewInfo>();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [access, setAccess] = useState<"public" | "protected">();
  const [password, setPassword] = useState<string>();
  useLayoutEffect(() => {
    mounted.current = true;
    const focus = document.activeElement;
    dialog.current?.showModal();
    window.easyProto
      .webPreview("status", scene.generation, pageId)
      .then((result) => {
        if (mounted.current) setInfo(result);
      })
      .catch(() => {
        if (mounted.current)
          setError("Couldn’t connect to the preview service. Reopen this dialog to try again.");
      })
      .finally(() => {
        if (mounted.current) setChecking(false);
      });
    return () => {
      mounted.current = false;
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, []);
  async function act(action: "sync" | "open" | "copy") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await window.easyProto.webPreview(
        action,
        scene.generation,
        pageId,
        scene.revision,
        action === "sync" ? access : undefined,
      );
      if (!mounted.current) return;
      setInfo(result);
      if (action === "sync") {
        if (access) setPassword(result.password);
        setAccess(undefined);
      }
      setNotice(
        action === "sync"
          ? "Page synced. Your preview is ready."
          : action === "copy"
            ? "Link copied."
            : "",
      );
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message.split("Error: ").at(-1) || "The page could not be synced."
            : "The page could not be synced.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function dismiss() {
    if (busy) await window.easyProto.webPreview("cancel", scene.generation, pageId).catch(() => {});
    dialog.current?.close();
    close();
  }
  const page = scene.pages.find(({ id }) => id === pageId);
  const count =
    info?.artboardCount ?? scene.artboards.filter((board) => board.pageId === pageId).length;
  return (
    <dialog
      ref={dialog}
      className={previewStyles.webPreviewDialog}
      aria-labelledby="web-preview-title"
      onCancel={(event) => {
        event.preventDefault();
        void dismiss();
      }}
    >
      <div className={previewStyles.webPreviewEyebrow}>
        {info?.hosted ? "Web preview" : "Local preview"}
      </div>
      <h2 id="web-preview-title">Share this page.</h2>
      <p>
        Export a read-only live preview of <strong>{page?.name}</strong>. Sync again to update the
        same link.
      </p>
      <div className={previewStyles.webPreviewSummary}>
        <strong>{page?.name}</strong>
        <span>
          {count} {count === 1 ? "artboard" : "artboards"}
        </span>
      </div>
      <div role="status" className={previewStyles.webPreviewStatus}>
        {checking ? "Connecting to preview…" : busy ? "Preparing preview…" : notice}
      </div>
      {error && <p role="alert">{error}</p>}
      {info && !info.configured && (
        <p>
          Start the development environment with <code>pnpm local:dev</code> to sync pages locally.
        </p>
      )}
      {info?.url && (
        <label className={previewStyles.webPreviewLink}>
          Preview link
          <input
            aria-label="Preview link"
            readOnly
            value={info.url}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
      {info?.hosted && (
        <fieldset className={previewStyles.webPreviewAccess} disabled={busy}>
          <legend>Access password</legend>
          <div>
            {access === "protected"
              ? "A new password will be generated when you sync."
              : access === "public"
                ? "The password will be removed when you sync."
                : info.access === "protected"
                  ? "Password required"
                  : "Anyone with the link"}
          </div>
          <button
            type="button"
            onClick={() => setAccess(access === "protected" ? undefined : "protected")}
          >
            {access === "protected"
              ? "Cancel password change"
              : info.access === "protected"
                ? "Replace password"
                : "Generate password"}
          </button>
          {info.access === "protected" && access !== "protected" && (
            <button
              type="button"
              onClick={() => setAccess(access === "public" ? undefined : "public")}
            >
              {access === "public" ? "Keep password" : "Remove password"}
            </button>
          )}
          {password && (
            <label className={previewStyles.webPreviewLink}>
              Send this password separately from the link.
              <input
                readOnly
                aria-label="Generated access password"
                value={password}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          )}
        </fieldset>
      )}
      <div className={previewStyles.webPreviewActions}>
        <button type="button" onClick={() => void dismiss()}>
          {busy ? "Cancel export" : "Close"}
        </button>
        {info?.url && (
          <>
            <button type="button" disabled={busy} onClick={() => void act("copy")}>
              Copy link
            </button>
            <button type="button" disabled={busy} onClick={() => void act("open")}>
              Open preview
            </button>
          </>
        )}
        <button
          type="button"
          className={previewStyles.webPreviewSync}
          disabled={checking || busy || !info?.configured || !count}
          onClick={() => void act("sync")}
        >
          Sync page
        </button>
      </div>
      <p className={previewStyles.webPreviewNote}>
        Only this page is shared. Local source files stay on your Mac.
      </p>
    </dialog>
  );
}
