import { Brand, WorkspaceHeader } from "@easy-proto/ui";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { startCamera } from "./camera";
import type { SharedPage } from "./page";
import fold from "@easy-proto/ui/fold.svg";

export function Landing() {
  const [pending, setPending] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || joined) return;
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fields.get("email"), website: fields.get("website") }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 400
            ? "Enter a valid email address."
            : "We couldn’t save your email. Please try again.",
        );
      setJoined(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="landing-page">
      <header className="site-header">
        <Link to="/" aria-label="Easy Proto home">
          <Brand />
        </Link>
        <span className="header-meta">A personal canvas for agent-made ideas.</span>
      </header>
      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <img className="landing-mark" src={fold} alt="" />
          <h1 id="landing-title">Easy Proto</h1>
          <p>
            Create with agents. Keep your files.
            <br />
            Share a page when it’s ready.
          </p>
          <form className="waitlist-form" onSubmit={(event) => void join(event)}>
            <label className="visually-hidden" htmlFor="waitlist-email">
              Email address
            </label>
            <input
              id="waitlist-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              placeholder="Your email address"
              required
              disabled={joined}
              aria-describedby="waitlist-status"
            />
            <div className="honeypot" aria-hidden="true">
              <label>
                Website
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <button disabled={pending || joined}>
              {joined ? "You’re on the list" : pending ? "Joining…" : "Join the waitlist"}
            </button>
          </form>
          <p
            id="waitlist-status"
            role="status"
            className={error ? "waitlist-error" : "waitlist-note"}
          >
            {error ||
              (joined
                ? "Thanks. We’ll be in touch when Easy Proto is ready."
                : "Just a note when Easy Proto is ready.")}
          </p>
        </section>
      </main>
      <footer className="landing-footer">Built for macOS. Shared on the web.</footer>
    </div>
  );
}

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
