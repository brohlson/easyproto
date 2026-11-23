import { Brand, Select } from "@easy-proto/ui";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { startCamera } from "./camera";
import { type Frame, type Page, type Scope, frameLabels, scopeLabels } from "./page";
import "./style.css";
import { Landing, SharedCanvas } from "./shared-pages";

const payload = document.querySelector<HTMLScriptElement>("#page-data");
let firstPage = payload?.textContent
  ? { path: location.pathname, data: JSON.parse(payload.textContent) as Page }
  : undefined;
payload?.remove();

async function loadPage({
  location,
  abortController,
}: {
  location: { pathname: string };
  abortController: AbortController;
}) {
  if (firstPage?.path === location.pathname) {
    const { data } = firstPage;
    firstPage = undefined;
    return data;
  }
  const response = await fetch(location.pathname, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    signal: abortController.signal,
  });
  if (!response.ok) return { kind: "unavailable" } as const;
  return (await response.json()) as Page;
}

const rootRoute = createRootRoute({
  component: Outlet,
  errorComponent: LayoutError,
  notFoundComponent: LayoutError,
});

function Header({ meta }: { meta: string }) {
  return (
    <header>
      <strong>
        <Brand />
      </strong>
      <span className="header-meta">{meta}</span>
    </header>
  );
}

function Layout({ view }: { view: Page }) {
  if (view.kind === "landing") return <Landing />;
  if (view.kind === "page-preview") return <SharedCanvas view={view} />;
  const meta =
    view.kind === "viewer"
      ? `${view.title} · Revision ${view.revision}`
      : view.kind === "publisher" || view.kind === "created"
        ? "Publisher · local demo"
        : "Local demo";
  return (
    <>
      <Header meta={meta} />
      <Content view={view} />
    </>
  );
}

function LayoutError() {
  return (
    <>
      <Header meta="Local demo" />
      <Unavailable />
    </>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="panel">
      <h1>{title}</h1>
      {children}
    </main>
  );
}

function Unavailable() {
  return (
    <Panel title="Preview unavailable">
      <p>Check the link and try again.</p>
    </Panel>
  );
}

function Content({ view }: { view: Page }) {
  switch (view.kind) {
    case "landing":
      return <Landing />;
    case "page-preview":
      return <SharedCanvas view={view} />;
    case "home":
      return <Home view={view} />;
    case "inbox":
      return <Inbox view={view} />;
    case "confirm":
      return <Confirm key={view.action} view={view} />;
    case "publisher":
      return <Publisher view={view} />;
    case "created":
      return <Created view={view} />;
    case "viewer":
      return <Viewer view={view} />;
    case "unavailable":
      return <Unavailable />;
  }
}

function Home({ view }: { view: Extract<Page, { kind: "home" }> }) {
  return (
    <Panel title="Sign in to publish">
      <p>Enter the demo account email to get a sign-in link in the local inbox.</p>
      <form method="post" action="/auth/request">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" placeholder={view.email} required />
        <button>Request sign-in link</button>
      </form>
    </Panel>
  );
}

function Inbox({ view }: { view: Extract<Page, { kind: "inbox" }> }) {
  return (
    <Panel title="Local inbox">
      {view.link ? (
        <>
          <p>Sign-in link for {view.email}.</p>
          <a className="button" href={view.link}>
            Open sign-in link
          </a>
        </>
      ) : (
        <>
          <p>No sign-in link is available for this browser.</p>
          <a href="/">Back to sign in</a>
        </>
      )}
    </Panel>
  );
}

function Confirm({ view }: { view: Extract<Page, { kind: "confirm" }> }) {
  const [secret] = useState(() => location.hash.slice(1));
  useLayoutEffect(() => {
    if (location.hash) history.replaceState(history.state, "", location.pathname);
  }, []);
  const valid = /^[\w-]{43}$/.test(secret);
  return (
    <Panel title={view.button}>
      <p>{view.details}</p>
      {valid ? (
        <form method="post" action={view.action}>
          <input type="hidden" name="secret" value={secret} />
          <button>{view.button}</button>
        </form>
      ) : (
        <p>This link is incomplete. Open the original link to continue.</p>
      )}
    </Panel>
  );
}

function Publisher({ view }: { view: Extract<Page, { kind: "publisher" }> }) {
  const [scope, setScope] = useState<Scope>("canvas");
  const [frame, setFrame] = useState<Frame>("none");
  return (
    <Panel title="Share Field Notes">
      <p>Publish a read-only preview of saved revision {view.revision}.</p>
      <form method="post" action="/publish/create">
        <label htmlFor="scope">Share</label>
        <Select<Scope>
          id="scope"
          name="scope"
          label="Share"
          value={scope}
          options={[
            { value: "canvas", label: scopeLabels.canvas },
            { value: "overview", label: scopeLabels.overview },
            { value: "today", label: scopeLabels.today },
          ]}
          onValueChange={(next) => {
            setScope(next);
            if (next === "canvas") setFrame("none");
          }}
        />
        <label htmlFor="frame">Device frame</label>
        <Select<Frame>
          id="frame"
          name="frame"
          label="Device frame"
          value={frame}
          options={[
            { value: "none", label: "None" },
            { value: "phone", label: frameLabels.phone, disabled: scope === "canvas" },
            { value: "laptop", label: frameLabels.laptop, disabled: scope === "canvas" },
          ]}
          onValueChange={setFrame}
        />
        <button>Create share link</button>
      </form>
      {view.shares.length > 0 && (
        <>
          <h2>Active links</h2>
          <ul className="shares">
            {view.shares.map(({ id, scope, frame }) => (
              <li key={id}>
                <span>
                  {scopeLabels[scope]} · {frameLabels[frame]}
                </span>
                <form method="post" action="/publish/revoke">
                  <input type="hidden" name="id" value={id} />
                  <button className="secondary">Revoke</button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function Created({ view }: { view: Extract<Page, { kind: "created" }> }) {
  const [copyLabel, setCopyLabel] = useState("Copy link");
  const input = useRef<HTMLInputElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(input.current!.value);
      setCopyLabel("Copied");
    } catch {
      input.current?.select();
      setCopyLabel("Select to copy");
    }
  }
  return (
    <Panel title="Share link created">
      <label htmlFor="link">Read-only preview link</label>
      <input ref={input} id="link" type="url" readOnly value={view.link} />
      <div className="row">
        <a className="button" href={view.link} target="_blank" rel="noopener noreferrer">
          Open preview
        </a>
        <button className="secondary" onClick={() => void copy()}>
          {copyLabel}
        </button>
      </div>
      <Link to="/publish">Manage links</Link>
    </Panel>
  );
}

function Viewer({ view }: { view: Extract<Page, { kind: "viewer" }> }) {
  const viewport = useRef<HTMLElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => startCamera(viewport.current!, controls.current!), [view]);
  return (
    <>
      <main
        ref={viewport}
        className="viewport"
        data-scope={view.scope}
        aria-label="Artboard preview"
      >
        <div className="camera">
          {view.boards.map((board) => (
            <figure key={board.id} data-x={board.x} data-y={board.y}>
              <figcaption>
                {board.name}{" "}
                <span>
                  {board.width} × {board.height}
                </span>
              </figcaption>
              <div className={`device ${view.frame}`}>
                <iframe
                  title={board.name}
                  src={`/s/${view.id}/boards/${board.id}`}
                  width={board.width}
                  height={board.height}
                  sandbox=""
                  tabIndex={-1}
                />
              </div>
            </figure>
          ))}
        </div>
      </main>
      <div ref={controls} className="controls" aria-label="Zoom controls">
        <button type="button" data-zoom="out" aria-label="Zoom out">
          −
        </button>
        <button type="button" data-zoom="fit">
          Fit
        </button>
        <button type="button" data-zoom="in" aria-label="Zoom in">
          +
        </button>
      </div>
    </>
  );
}

function pageRoute<const Path extends string>(path: Path) {
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path,
    loader: loadPage,
    component: RoutePage,
  });
  function RoutePage() {
    return <Layout view={route.useLoaderData()} />;
  }
  return route;
}

const routeTree = rootRoute.addChildren([
  pageRoute("/"),
  pageRoute("/demo"),
  pageRoute("/p/$previewId"),
  pageRoute("/dev/inbox"),
  pageRoute("/auth/continue"),
  pageRoute("/publish"),
  pageRoute("/publish/create"),
  pageRoute("/s/$shareId"),
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
