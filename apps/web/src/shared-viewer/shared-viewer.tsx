import { Brand, WorkspaceHeader } from "@easy-proto/ui";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef } from "react";
import { startCamera } from "../canvas/camera";
import type { SharedPage } from "./page";

export function SharedCanvas({ view }: { view: SharedPage }) {
  const viewport = useRef<HTMLElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => startCamera(viewport.current!, controls.current!), [view]);
  return (
    <div ref={controls} className="shared-page">
      <WorkspaceHeader
        brand={
          <Link to="/" aria-label="Easy Proto home">
            <Brand />
          </Link>
        }
        project={<span className="ep-workspace-label">{view.projectName}</span>}
        page={<span className="ep-workspace-label">{view.pageName}</span>}
        actions={<span className="readonly-badge">Read-only preview</span>}
      />
      <main
        ref={viewport}
        className="viewport shared-viewport"
        data-scope="canvas"
        aria-label={`Read-only canvas: ${view.pageName}`}
        tabIndex={0}
      >
        <div className="camera">
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
      <div className="controls" aria-label="Zoom controls">
        <button data-zoom="out" aria-label="Zoom out">
          −
        </button>
        <button data-zoom="fit">Fit</button>
        <output data-zoom-label aria-label="Canvas zoom" />
        <button data-zoom="in" aria-label="Zoom in">
          +
        </button>
      </div>
    </div>
  );
}
