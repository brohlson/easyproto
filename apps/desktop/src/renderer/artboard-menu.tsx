import { ChevronLeft, ChevronRight, File, Pencil, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { Page } from "../shared/model";

export type MenuAnchor = { x: number; y: number; owner: HTMLElement };

export function ArtboardMenu({
  anchor,
  startWithPages,
  pages,
  count,
  disabled,
  dismiss,
  rename,
  remove,
  move,
}: {
  anchor: MenuAnchor;
  startWithPages: boolean;
  pages: Page[];
  count: number;
  disabled: boolean;
  dismiss(): void;
  rename(): void;
  remove(): void;
  move(pageId: string): void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [choosingPage, setChoosingPage] = useState(startWithPages);
  const caption = choosingPage
    ? `Move ${count} ${count === 1 ? "artboard" : "artboards"} to`
    : "Artboard actions";

  useLayoutEffect(() => {
    const el = panel.current!;
    el.showPopover();
    function position() {
      const top = startWithPages ? anchor.y - el.offsetHeight : anchor.y;
      el.style.left =
        Math.max(4, Math.min(anchor.x, window.innerWidth - el.offsetWidth - 4)) + "px";
      el.style.top = Math.max(4, Math.min(top, window.innerHeight - el.offsetHeight - 4)) + "px";
    }
    position();
    el.querySelector<HTMLButtonElement>("button:enabled")?.focus();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [anchor, choosingPage, startWithPages]);

  function close() {
    panel.current?.hidePopover();
    anchor.owner.focus({ preventScroll: true });
    dismiss();
  }

  return (
    <div
      ref={panel}
      popover="auto"
      className="menu-panel artboard-menu"
      role="menu"
      aria-label={caption}
      onToggle={(event) => {
        if (event.newState === "closed" && !event.currentTarget.matches(":popover-open")) dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          event.stopPropagation();
          close();
          return;
        }
        if (event.key === "ArrowLeft" && choosingPage && !startWithPages) {
          event.preventDefault();
          setChoosingPage(false);
          return;
        }
        const actions = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled"),
        );
        const index = actions.indexOf(document.activeElement as HTMLButtonElement);
        const direction = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        if (direction && actions.length) {
          event.preventDefault();
          actions[(index + direction + actions.length) % actions.length]?.focus();
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          actions[event.key === "Home" ? 0 : actions.length - 1]?.focus();
        }
      }}
    >
      {choosingPage ? (
        <>
          {!startWithPages && (
            <button
              type="button"
              role="menuitem"
              className="menu-row"
              onClick={() => setChoosingPage(false)}
            >
              <ChevronLeft size={14} aria-hidden="true" /> Back
            </button>
          )}
          <div className="menu-caption">{caption}</div>
          {pages.map((page) => (
            <button
              type="button"
              key={page.id}
              role="menuitem"
              className="menu-row page-row"
              title={page.name}
              disabled={disabled}
              onClick={() => {
                close();
                move(page.id);
              }}
            >
              <File size={14} aria-hidden="true" />
              <span>{page.name}</span>
            </button>
          ))}
        </>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            className="menu-row"
            disabled={disabled || !pages.length}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" && pages.length) {
                event.preventDefault();
                setChoosingPage(true);
              }
            }}
            onClick={() => setChoosingPage(true)}
          >
            Move to page <ChevronRight size={14} aria-hidden="true" className="menu-check" />
          </button>
          {count === 1 && (
            <button
              type="button"
              role="menuitem"
              className="menu-row"
              disabled={disabled}
              onClick={() => {
                close();
                rename();
              }}
            >
              <Pencil size={14} aria-hidden="true" />
              Rename
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="menu-row"
            disabled={disabled}
            onClick={() => {
              close();
              remove();
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        </>
      )}
    </div>
  );
}
