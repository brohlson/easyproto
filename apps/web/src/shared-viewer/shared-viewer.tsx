import { Brand, WorkspaceHeader, WorkspaceLabel } from "@easy-proto/ui";
import { useLayoutEffect, useRef } from "react";
import { BoardPreview } from "../canvas/board-preview";
import { startCamera } from "../canvas/camera";
import chrome from "../chrome.module.css";
import canvas from "../canvas/canvas.module.css";
import styles from "./shared-viewer.module.css";
import type { SharedPage } from "./page";
import { TokenDialog } from "./token-dialog";

export function SharedCanvas({ view }: { view: SharedPage }) {
  const viewport = useRef<HTMLElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => startCamera(viewport.current!, controls.current!), [view]);
  return (
    <div ref={controls}>
      <WorkspaceHeader
        brand={
          <a href="/" aria-label="Easy Proto home">
            <Brand />
          </a>
        }
        project={<WorkspaceLabel>{view.projectName}</WorkspaceLabel>}
        page={<WorkspaceLabel>{view.pageName}</WorkspaceLabel>}
        actions={
          <div className={styles.headerActions}>
            <span className={styles.readonlyBadge}>Read-only preview</span>
            <TokenDialog
              key={view.artboards[0]?.iframeUrl}
              iframeUrl={view.artboards[0]?.iframeUrl}
              tokensUrl={view.tokensUrl}
            />
          </div>
        }
      />
      <main
        ref={viewport}
        className={`${canvas.viewport} ${styles.sharedViewport}`}
        data-scope="canvas"
        aria-label={`Read-only canvas: ${view.pageName}`}
        tabIndex={0}
      >
        <div className={canvas.camera} data-camera>
          {view.artboards.map((board) => (
            <figure
              key={board.id}
              data-id={board.id}
              data-x={board.x}
              data-y={board.y}
              style={{ width: board.width, height: board.height }}
            >
              <figcaption>
                {board.name}
                <span>
                  {board.width} × {board.height}
                </span>
              </figcaption>
              <BoardPreview
                key={board.iframeUrl}
                className={styles.preview}
                src={board.iframeUrl}
                title={board.name}
                width={board.width}
                height={board.height}
              />
            </figure>
          ))}
        </div>
      </main>
      <div className={canvas.controls} aria-label="Zoom controls">
        <button className={chrome.button} data-zoom="out" aria-label="Zoom out">
          −
        </button>
        <button className={chrome.button} data-zoom="fit">
          Fit
        </button>
        <output className={styles.zoomLabel} data-zoom-label aria-label="Canvas zoom" />
        <button className={chrome.button} data-zoom="in" aria-label="Zoom in">
          +
        </button>
      </div>
    </div>
  );
}
