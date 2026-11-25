import { homeUrl } from "../src/landing/content.ts";
import { headers } from "./http.ts";

export const publicOrigin = new URL(homeUrl).origin;
const sitemapUrl = new URL("sitemap.xml", homeUrl).href;

export function indexingPolicy(url: URL, response: Response) {
  const homepage = url.origin === publicOrigin && url.pathname === "/";
  if (homepage && (response.ok || response.status === 304)) return response;

  const directive = headers["X-Robots-Tag"];
  if (response.headers.get("X-Robots-Tag") === directive) return response;
  const tagged = new Response(response.body, response);
  tagged.headers.set("X-Robots-Tag", directive);
  return tagged;
}

export function crawlFile(request: Request, url: URL) {
  const production = url.origin === publicOrigin;
  const robots = url.pathname === "/robots.txt";
  if (!robots && !production) return undefined;
  const body = robots
    ? `User-agent: *\nAllow: /\n${production ? `Sitemap: ${sitemapUrl}\n` : ""}`
    : `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${homeUrl}</loc></url></urlset>\n`;
  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": robots ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
