import type { PublicPreview } from "./previews.ts";

const policy =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function htmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function serveSite(request: Request, env: Env, sharedPage?: PublicPreview) {
  const response = await env.ASSETS.fetch(request);
  let body: BodyInit | null = response.body;
  if (sharedPage && response.ok) {
    const data = JSON.stringify(sharedPage).replaceAll("<", "\\u003c");
    body = (await response.text())
      .replace(
        /<title>[^<]*<\/title>/,
        `<title>${htmlText(sharedPage.projectName)} - ${htmlText(sharedPage.pageName)}</title>`,
      )
      .replace(
        '<div id="root"></div>',
        `<div id="root"></div><script id="page-data" type="application/json">${data}</script>`,
      );
  }
  const secured = new Response(body, response);
  secured.headers.delete("Content-Length");
  secured.headers.set("Content-Security-Policy", policy);
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  return secured;
}
