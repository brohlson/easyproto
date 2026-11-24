import { Brand, WorkspaceHeader, WorkspaceLabel } from "@easy-proto/ui";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef } from "react";
import { startCamera } from "../canvas/camera";
import chrome from "../chrome.module.css";
import canvas from "../canvas/canvas.module.css";
import styles from "./shared-viewer.module.css";
import type { SharedPage } from "./page";

export function SharedCanvas({ view }: { view: SharedPage }) {
  const viewport = useRef<HTMLElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => startCamera(viewport.current!, controls.current!), [view]);
  return (
    <div ref={controls}>
      <WorkspaceHeader
        brand={
          <Link to="/" aria-label="Easy Proto home">
            <Brand />
          </Link>
        }
        project={<WorkspaceLabel>{view.projectName}</WorkspaceLabel>}
        page={<WorkspaceLabel>{view.pageName}</WorkspaceLabel>}
        actions={<span className={styles.readonlyBadge}>Read-only preview</span>}
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
              <iframe
                src={board.iframeUrl}
                title={board.name}
                width={board.width}
                height={board.height}
                sandbox=""
                tabIndex={-1}
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
