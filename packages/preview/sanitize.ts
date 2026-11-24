import { defaultTreeAdapter, parse, serialize, type DefaultTreeAdapterTypes } from "parse5";

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
