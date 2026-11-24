import { z } from "zod";
import { defaultTreeAdapter, parse, serialize, type DefaultTreeAdapterTypes } from "parse5";

export const previewLimits = {
  boards: 50,
  documentBytes: 256_000,
  stylesheetBytes: 128_000,
  tokenBytes: 256_000,
  assetBytes: 8 * 1024 * 1024,
  assetsPerBoard: 256,
  uploadBytes: 32 * 1024 * 1024,
};
const name = z.string().trim().min(1).max(100);
const member = (max: number) =>
  z.strictObject({
    bytes: z.number().int().positive().max(max),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  });
const assetPath = z
  .string()
  .min(1)
  .max(512)
  .refine((path) => {
    const parts = path.split("/");
    return (
      parts.length <= 12 &&
      parts.every(
        // oxlint-disable-next-line no-control-regex
        (part) => part && part !== "." && part !== ".." && !/[\\\u0000-\u001f]/.test(part),
      )
    );
  }, "Asset paths must be canonical project-relative paths.");
const asset = member(previewLimits.assetBytes).extend({
  path: assetPath,
  mime: z.enum([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/avif",
    "font/woff2",
    "font/woff",
  ]),
});
export const previewManifest = z
  .strictObject({
    schemaVersion: z.literal(2),
    projectName: name,
    pageName: name,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    artboards: z
      .array(
        z.strictObject({
          id: z.uuid(),
          name,
          x: z.number().min(-100_000).max(100_000),
          y: z.number().min(-100_000).max(100_000),
          width: z.number().int().min(100).max(2560),
          height: z.number().int().min(100).max(2560),
          document: member(previewLimits.documentBytes),
          stylesheet: member(previewLimits.stylesheetBytes),
          tokens: member(previewLimits.tokenBytes).optional(),
          assets: z
            .array(asset)
            .max(previewLimits.assetsPerBoard)
            .refine(
              (assets) => new Set(assets.map(({ path }) => path)).size === assets.length,
              "Asset paths must be unique within an artboard.",
            ),
        }),
      )
      .min(1)
      .max(previewLimits.boards),
  })
  .refine(
    (manifest) =>
      new Set(manifest.artboards.map(({ id }) => id)).size === manifest.artboards.length,
    "Artboard IDs must be unique.",
  );
export const pageUpload = z.strictObject({
  projectId: z.uuid(),
  pageId: z.uuid(),
  manifest: previewManifest,
});
export type PreviewManifest = z.infer<typeof previewManifest>;
export type PageUpload = z.infer<typeof pageUpload>;
export type WebPreviewInfo = {
  configured: boolean;
  pageName: string;
  artboardCount: number;
  url?: string;
  revision?: number;
  updatedAt?: string;
};

const removedTags = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "fencedframe",
  "object",
  "embed",
  "applet",
  "portal",
  "base",
  "link",
  "meta",
  "noscript",
  "template",
  "audio",
  "video",
  "track",
  "form",
]);
const removedAttributes = new Set([
  "autofocus",
  "ping",
  "target",
  "srcdoc",
  "action",
  "formaction",
  "download",
  "attributionsrc",
  "imagesrcset",
  "imagesizes",
  "loading",
]);

export function previewHtml(html: string, hasTokens: boolean) {
  const parsed = parse(html, { scriptingEnabled: false });
  const pending: { parent: DefaultTreeAdapterTypes.ParentNode; depth: number }[] = [
    { parent: parsed, depth: 0 },
  ];
  while (pending.length) {
    const { parent, depth } = pending.pop()!;
    parent.childNodes = parent.childNodes.filter((child) => {
      if (!("tagName" in child)) return true;
      if (depth >= 128 || removedTags.has(child.tagName)) return false;
      child.attrs = child.attrs.filter(
        ({ name }) =>
          !name.startsWith("on") &&
          !removedAttributes.has(name) &&
          !((child.tagName === "a" || child.tagName === "area") && name === "href"),
      );
      pending.push({ parent: child, depth: depth + 1 });
      return true;
    });
  }
  const root = parsed.childNodes.find((child) => defaultTreeAdapter.isElementNode(child));
  const head = root?.childNodes.find(
    (child) => defaultTreeAdapter.isElementNode(child) && child.tagName === "head",
  );
  if (!head || !defaultTreeAdapter.isElementNode(head))
    throw new Error("Preview HTML has no head.");
  const stylesheet = defaultTreeAdapter.createElement("link", head.namespaceURI, [
    { name: "rel", value: "stylesheet" },
    { name: "href", value: "./board.css" },
  ]);
  if (head.childNodes.length) defaultTreeAdapter.insertBefore(head, stylesheet, head.childNodes[0]);
  else defaultTreeAdapter.appendChild(head, stylesheet);
  if (hasTokens) {
    const tokens = defaultTreeAdapter.createElement("link", head.namespaceURI, [
      { name: "rel", value: "stylesheet" },
      { name: "href", value: "./tokens.css" },
    ]);
    defaultTreeAdapter.insertBefore(head, tokens, stylesheet);
  }
  defaultTreeAdapter.setDocumentType(parsed, "html", "", "");
  return serialize(parsed);
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
