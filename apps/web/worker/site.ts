import type { PublicPreview } from "./previews.ts";
import { headers } from "./http.ts";
import { publicOrigin } from "./seo.ts";

function policy(frameOrigin: string) {
  return `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src ${frameOrigin}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}

function htmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function serveSite(
  request: Request,
  env: Env,
  sharedPage?: PublicPreview | { kind: "locked-preview"; id: string },
  frameOrigin = "'self'",
) {
  const url = new URL(request.url);
  const home = url.pathname === "/" && !sharedPage;
  const indexable = home && url.origin === publicOrigin;
  const asset = sharedPage ? "/shared-preview.html" : home ? "/index.html" : url.pathname;
  const requestHeaders = new Headers(request.headers);
  if (sharedPage) {
    // The exported shell's validators do not describe an authorized share.
    for (const header of ["If-None-Match", "If-Modified-Since", "Range", "If-Range"])
      requestHeaders.delete(header);
  }
  const response = await env.ASSETS.fetch(
    new Request(new URL(asset, url), { method: request.method, headers: requestHeaders }),
  );
  let body: BodyInit | null = response.body;
  if (sharedPage && response.ok && request.method === "GET") {
    const data = JSON.stringify(sharedPage).replaceAll("<", "\\u003c");
    const title =
      sharedPage.kind === "page-preview"
        ? `${htmlText(sharedPage.projectName)} - ${htmlText(sharedPage.pageName)}`
        : "Easy Proto";
    body = (await response.text())
      .replace(/(<title\b[^>]*>)[^<]*<\/title>/, (_, tag: string) => `${tag}${title}</title>`)
      .replace(
        "</body>",
        () => `<script id="page-data" type="application/json">${data}</script></body>`,
      );
  }
  const secured = new Response(body, response);
  if (sharedPage) {
    secured.headers.delete("Content-Length");
    secured.headers.delete("ETag");
    secured.headers.delete("Last-Modified");
  }
  secured.headers.set("Content-Security-Policy", policy(frameOrigin));
  if (sharedPage)
    for (const [name, value] of Object.entries(headers)) secured.headers.set(name, value);
  if (!indexable && secured.headers.get("Content-Type")?.startsWith("text/html"))
    secured.headers.set("X-Robots-Tag", headers["X-Robots-Tag"]);
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  return secured;
}
