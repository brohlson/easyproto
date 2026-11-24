import { createHash } from "node:crypto";
import { visit } from "jsonc-parser";
import StyleDictionary from "style-dictionary";
import type { DesignTokens } from "style-dictionary/types";
import { z } from "zod";
import {
  tokenByteLimit,
  tokenTypes,
  type TokenLiteral,
  type TokenRow,
  type TokenType,
} from "../shared/token-types.ts";

const safeSegment = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const forbiddenSegments = new Set(["constructor", "prototype", "__proto__"]);
const metadata = new Set(["$description", "$deprecated", "$extensions"]);
const component = z.number().min(0).max(1);
const numeric = z.number().min(-1_000_000).max(1_000_000);
const fontName = z
  .string()
  .max(64)
  .regex(/^-?[a-zA-Z][a-zA-Z0-9-]*(?: [a-zA-Z0-9][a-zA-Z0-9-]*)*$/)
  .refine((name) => !/^(?:inherit|initial|unset|revert|revert-layer|default)$/i.test(name));
const literals = {
  color: z.strictObject({
    colorSpace: z.literal("srgb"),
    components: z.tuple([component, component, component]),
    alpha: component.optional(),
    hex: z
      .string()
      .regex(/^#[a-fA-F0-9]{6}$/)
      .optional(),
  }),
  dimension: z.strictObject({ value: numeric, unit: z.enum(["px", "rem"]) }),
  number: numeric,
  fontFamily: z.union([fontName.transform((name) => [name]), z.array(fontName).min(1).max(12)]),
  fontWeight: z.number().min(1).max(1000),
  duration: z.strictObject({ value: numeric.min(0), unit: z.enum(["ms", "s"]) }),
};

export type TokenBundle = {
  document: string;
  css: string;
  rows: TokenRow[];
  stamp: { documentDigest: string; cssDigest: string };
};

type TokenEntry = Omit<TokenRow, "resolved">;
type Tree = Record<string, unknown>;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): value is Tree =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export class TokenError extends Error {}

export function parseTokenDocument(text: string) {
  if (Buffer.byteLength(text) > tokenByteLimit) throw new TokenError("Token JSON is too large.");
  const stack: (Set<string> | null)[] = [];
  function enter(fields: Set<string> | null) {
    stack.push(fields);
    if (stack.length > 24) throw new TokenError("Token JSON is nested too deeply.");
  }
  visit(
    text,
    {
      onObjectBegin: () => enter(new Set()),
      onArrayBegin: () => enter(null),
      onObjectEnd: () => void stack.pop(),
      onArrayEnd: () => void stack.pop(),
      onObjectProperty: (key) => {
        const fields = stack.at(-1);
        if (fields?.has(key)) throw new TokenError(`Duplicate JSON key “${key}”.`);
        fields?.add(key);
      },
      onError: () => {
        throw new TokenError("Enter valid token JSON.");
      },
    },
    { disallowComments: true },
  );
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TokenError("Enter valid token JSON.");
  }
  if (!object(raw) || Object.hasOwn(raw, "$value"))
    throw new TokenError("The token document must contain named tokens or groups.");

  const tokens = new Map<string, TokenEntry>();
  const cssNames = new Set<string>();
  function walk(node: Tree, segments: string[], inherited?: TokenType): Tree {
    const path = segments.join(".");
    const location = path || "Token document";
    if (segments.length > 8) throw new TokenError(`${location} is nested too deeply.`);
    const hasValue = Object.hasOwn(node, "$value");
    let type = inherited;
    if (Object.hasOwn(node, "$type")) {
      const declared = node.$type;
      if (!tokenTypes.some((supported) => supported === declared))
        throw new TokenError(`${location} uses an unsupported token type.`);
      type = declared as TokenType;
    }
    if (Object.hasOwn(node, "$description") && typeof node.$description !== "string")
      throw new TokenError(`${location} has an invalid description.`);
    if (
      Object.hasOwn(node, "$deprecated") &&
      typeof node.$deprecated !== "boolean" &&
      typeof node.$deprecated !== "string"
    )
      throw new TokenError(`${location} has invalid deprecation metadata.`);
    if (Object.hasOwn(node, "$extensions") && !object(node.$extensions))
      throw new TokenError(`${location} has invalid extensions.`);

    if (hasValue) {
      if (
        Object.keys(node).some((key) => !metadata.has(key) && key !== "$type" && key !== "$value")
      )
        throw new TokenError(`${location} has unsupported token properties.`);
      if (!type) throw new TokenError(`${location} needs a token type.`);
      const value = node.$value;
      const alias = typeof value === "string" && /^\{[a-z0-9-]+(?:\.[a-z0-9-]+)*\}$/.test(value);
      const parsed = literals[type].safeParse(value);
      if (!alias && !parsed.success)
        throw new TokenError(`${location} needs a valid ${type} value or a whole-token alias.`);
      const cssName = `--ep-${segments.join("-")}`;
      if (cssNames.has(cssName))
        throw new TokenError(`${location} collides with another CSS name (${cssName}).`);
      if (tokens.size >= 256) throw new TokenError("A project supports up to 256 tokens.");
      cssNames.add(cssName);
      tokens.set(path, { path, type, cssName, value: alias ? value : parsed.data! });
      return { $type: type, $value: alias ? value : parsed.data };
    }

    return Object.fromEntries(
      Object.keys(node)
        .sort()
        .flatMap((key) => {
          if (metadata.has(key) || key === "$type") return [];
          if (
            !safeSegment.test(key) ||
            key.length > 48 ||
            forbiddenSegments.has(key) ||
            !object(node[key])
          )
            throw new TokenError(`${location} has an unsupported token name or property “${key}”.`);
          return [[key, walk(node[key], [...segments, key], type)]];
        }),
    );
  }

  const input = walk(raw, []);
  const resolved = new Map<string, TokenLiteral>();
  const visiting = new Set<string>();
  function resolve(token: TokenEntry): TokenLiteral {
    const cached = resolved.get(token.path);
    if (cached !== undefined) return cached;
    if (visiting.has(token.path)) throw new TokenError(`${token.path} has a circular alias.`);
    visiting.add(token.path);
    const { value } = token;
    let literal: TokenLiteral;
    if (typeof value === "string") {
      const target = tokens.get(value.slice(1, -1));
      if (!target) throw new TokenError(`${token.path} references a missing token ${value}.`);
      if (target.type !== token.type)
        throw new TokenError(`${token.path} references a different token type.`);
      literal = resolve(target);
    } else {
      literal = value;
    }
    visiting.delete(token.path);
    resolved.set(token.path, literal);
    return literal;
  }
  return {
    input,
    document: JSON.stringify(raw, null, 2) + "\n",
    rows: [...tokens.values()].map((token) => ({ ...token, resolved: resolve(token) })),
  };
}

function fontFamilyCss(families: string[]) {
  return families.map((name) => (name.includes(" ") ? `"${name}"` : name)).join(", ");
}

function matchesLiteralCss(row: TokenRow, value: string) {
  const { resolved } = row;
  switch (row.type) {
    case "color":
      return /^(?:#[a-fA-F0-9]{3,8}|rgba?\([0-9., %]+\))$/.test(value);
    case "dimension":
      return /^-?[0-9.]+(?:e[+-]?\d+)?(?:px|rem)$/.test(value);
    case "number":
      return /^-?[0-9.]+(?:e[+-]?\d+)?$/.test(value);
    case "fontWeight":
      return value === String(resolved);
    case "fontFamily":
      return Array.isArray(resolved) && value === fontFamilyCss(resolved);
    case "duration":
      return (
        typeof resolved === "object" &&
        "unit" in resolved &&
        value === `${resolved.value}${resolved.unit}`
      );
  }
}

function checkedCss(css: string, rows: TokenRow[]) {
  if (Buffer.byteLength(css) > tokenByteLimit)
    throw new TokenError("Generated token CSS is too large.");
  if (!rows.length && css === "") return;
  const lines = css.trimEnd().split("\n");
  if (lines.shift() !== ":root {" || lines.pop() !== "}" || lines.length !== rows.length)
    throw new TokenError("Invalid generated token stylesheet.");
  const remaining = new Map(rows.map((row) => [row.cssName, row]));
  const byPath = new Map(rows.map((row) => [row.path, row]));
  for (const line of lines) {
    const match = /^  (--ep-[a-z0-9-]+): (.+);$/.exec(line);
    const row = match ? remaining.get(match[1]) : undefined;
    const value = match?.[2] ?? "";
    const valid =
      row &&
      (typeof row.value === "string"
        ? value === `var(${byPath.get(row.value.slice(1, -1))?.cssName})`
        : matchesLiteralCss(row, value));
    if (!valid || !row) throw new TokenError("Invalid generated token declaration.");
    remaining.delete(row.cssName);
  }
}

export async function compileTokens(text: string): Promise<TokenBundle> {
  const parsed = parseTokenDocument(text);
  if (Buffer.byteLength(parsed.document) > tokenByteLimit)
    throw new TokenError("Formatted token JSON is too large.");
  let css = "";
  if (parsed.rows.length) {
    const dictionary = new StyleDictionary({
      tokens: parsed.input as DesignTokens,
      usesDtcg: true,
      log: { verbosity: "silent", warnings: "error", errors: { brokenReferences: "throw" } },
      hooks: {
        transforms: {
          "name/easy-proto": { type: "name", transform: ({ path }) => ["ep", ...path].join("-") },
          "size/easy-proto": {
            type: "value",
            filter: (token) => token.$type === "dimension" || token.$type === "duration",
            transform: ({ $value }) => `${$value.value}${$value.unit}`,
          },
          "font/easy-proto": {
            type: "value",
            filter: (token) => token.$type === "fontFamily",
            transform: ({ $value }) => fontFamilyCss($value),
          },
        },
      },
      platforms: {
        css: {
          transforms: ["name/easy-proto", "size/easy-proto", "color/css", "font/easy-proto"],
          files: [
            { format: "css/variables", options: { showFileHeader: false, outputReferences: true } },
          ],
        },
      },
    });
    try {
      const [file] = await dictionary.formatPlatform("css");
      if (typeof file?.output !== "string") throw new Error("No CSS output.");
      css = file.output;
    } catch {
      throw new TokenError("Style Dictionary could not format these tokens.");
    }
  }
  checkedCss(css, parsed.rows);
  return {
    document: parsed.document,
    css,
    rows: parsed.rows,
    stamp: { documentDigest: sha(parsed.document), cssDigest: sha(css) },
  };
}

export function loadTokens(
  document: string,
  css: string,
  stamp: TokenBundle["stamp"],
): TokenBundle {
  if (sha(document) !== stamp.documentDigest || sha(css) !== stamp.cssDigest)
    throw new TokenError("The saved token files do not match their manifest.");
  const { rows } = parseTokenDocument(document);
  checkedCss(css, rows);
  return { document, css, rows, stamp };
}
