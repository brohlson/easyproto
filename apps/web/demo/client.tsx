import "@easy-proto/ui/theme.css";
import "../src/base.css";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { Demo, DemoError } from "../src/demo/demo";
import type { DemoPage } from "../src/demo/page";

const payload = document.querySelector<HTMLScriptElement>("#page-data");
let firstPage = payload?.textContent
  ? { path: location.pathname, data: JSON.parse(payload.textContent) as DemoPage }
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
  return (await response.json()) as DemoPage;
}

const rootRoute = createRootRoute({
  component: Outlet,
  errorComponent: DemoError,
  notFoundComponent: DemoError,
});

function pageRoute<const Path extends string>(path: Path) {
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path,
    loader: loadPage,
    component: RoutePage,
  });
  function RoutePage() {
    return <Demo view={route.useLoaderData()} />;
  }
  return route;
}

const routeTree = rootRoute.addChildren([
  pageRoute("/"),
  pageRoute("/demo"),
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
