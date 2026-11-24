import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

// No project is read or created by this probe. Verify the service before sending its capability.
export async function inspectLocalServer(settings) {
  let response;
  try {
    response = await fetch(new URL("/api/health", settings.origin), {
      redirect: "error",
      signal: AbortSignal.timeout(1500),
    });
  } catch (failure) {
    if (failure.cause?.code === "ECONNREFUSED") return false;
    throw new Error("Could not inspect the local preview port. Stop its listener and try again.");
  }
  const health = await response.json().catch(() => null);
  if (!response.ok || health?.ready !== true || health.service !== "easy-proto-web")
    throw new Error(
      "The local preview port is occupied by another or outdated service. Stop it and try again.",
    );
  const url = new URL("/api/local/page", settings.origin);
  url.searchParams.set("projectId", randomUUID());
  url.searchParams.set("pageId", randomUUID());
  const status = await fetch(url, {
    headers: { authorization: `Bearer ${settings.token}` },
    redirect: "error",
    signal: AbortSignal.timeout(1500),
  }).catch(() => {
    throw new Error("Could not connect to the local publisher. Stop its listener and try again.");
  });
  const payload = await status.json().catch(() => null);
  if (!status.ok || payload?.preview !== null)
    throw new Error(
      "The running preview server has different publishing settings. Stop it and try again.",
    );
  return true;
}

export async function waitForLocalServer(settings, child, stopped) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (stopped() || child.exitCode !== null || child.signalCode !== null)
      throw new Error("The local preview server stopped before it was ready.");
    if (await inspectLocalServer(settings)) return;
    await delay(200);
  }
  throw new Error("The local web environment did not become ready.");
}
