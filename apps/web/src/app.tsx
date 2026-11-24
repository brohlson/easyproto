import "@easy-proto/ui/theme.css";
import "./base.css";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import faviconUrl from "@easy-proto/ui/fold.svg?url";
import { Demo, DemoError } from "./demo/demo";
import type { Page } from "./page";
import { Landing } from "./landing/landing";
import { SharedCanvas } from "./shared-viewer/shared-viewer";

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (favicon) favicon.href = faviconUrl;

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
  errorComponent: DemoError,
  notFoundComponent: DemoError,
});

function Layout({ view }: { view: Page }) {
  useLayoutEffect(() => {
    document.title =
      view.kind === "page-preview" ? `${view.projectName} - ${view.pageName}` : "Easy Proto";
  }, [view]);
  if (view.kind === "landing") return <Landing />;
  if (view.kind === "page-preview") return <SharedCanvas view={view} />;
  return <Demo view={view} />;
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
