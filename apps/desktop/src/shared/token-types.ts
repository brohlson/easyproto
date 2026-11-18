export const tokenByteLimit = 128 * 1024;
export const tokenTypes = [
  "color",
  "dimension",
  "number",
  "fontFamily",
  "fontWeight",
  "duration",
] as const;
export type TokenType = (typeof tokenTypes)[number];
export type TokenLiteral =
  | number
  | string[]
  | { value: number; unit: "px" | "rem" | "ms" | "s" }
  | TokenColor;
export type TokenColor = {
  colorSpace: "srgb";
  components: [number, number, number];
  alpha?: number;
  hex?: string;
};

export function colorToHex(value: TokenColor) {
  const bytes =
    value.alpha === undefined || value.alpha === 1
      ? value.components
      : [...value.components, value.alpha];
  return (
    "#" +
    bytes
      .map((byte) =>
        Math.round(byte * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export type TokenRow = {
  path: string;
  type: TokenType;
  value: TokenLiteral | string;
  resolved: TokenLiteral;
  cssName: string;
};

export type TokenView = {
  revision: number;
  document: string;
  css: string;
  rows: TokenRow[];
};
