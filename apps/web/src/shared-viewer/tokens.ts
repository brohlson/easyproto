const number = "-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?";
const unitless = new RegExp(`^${number}$`, "i");
const measured = new RegExp(`^(${number})(px|rem|ms|s)$`, "i");
const alias = /^var\((--ep-[a-z0-9-]+)\)$/;

function color(value: string) {
  const hex = /^#([a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.exec(value)?.[1];
  if (hex) {
    const expanded = hex.length < 5 ? [...hex].map((digit) => digit.repeat(2)).join("") : hex;
    const [red, green, blue, alpha = 255] = expanded
      .match(/../g)!
      .map((pair) => parseInt(pair, 16));
    return { red, green, blue, opacity: alpha / 255 };
  }
  const rgb = /^rgba?\(([^()]+)\)$/i.exec(value)?.[1];
  if (!rgb) return;
  const channels = rgb.split(",").map((channel) => channel.trim());
  if (channels.length !== 3 && channels.length !== 4) return;
  const [red, green, blue, opacity = 1] = channels.map((channel, index) => {
    const percent = channel.endsWith("%");
    const input = percent ? channel.slice(0, -1) : channel;
    return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(input)
      ? Number(input) * (percent ? (index === 3 ? 0.01 : 2.55) : 1)
      : NaN;
  });
  if ([red, green, blue].some((value) => !(value >= 0 && value <= 255.001))) return;
  if (!(opacity >= 0 && opacity <= 1)) return;
  return { red, green, blue, opacity };
}

export type SharedToken = {
  cssName: string;
  value: string;
  resolved: string;
};

export function readSharedTokens(css: string): SharedToken[] {
  if (!css.trim()) return [];
  const lines = css.trimEnd().split(/\r?\n/);
  if (lines.shift() !== ":root {" || lines.pop() !== "}")
    throw new Error("Unsupported token stylesheet.");
  const declarations = new Map<string, string>();
  for (const line of lines) {
    const match = /^  (--ep-[a-z0-9-]+): ([^;{}]+);$/.exec(line);
    if (!match || declarations.has(match[1])) throw new Error("Invalid token declaration.");
    declarations.set(match[1], match[2]);
  }
  const resolved = new Map<string, string>();
  for (const name of declarations.keys()) {
    const chain = new Set<string>();
    let current = name;
    while (!resolved.has(current)) {
      const value = declarations.get(current);
      if (!value || chain.has(current)) throw new Error("Invalid token alias.");
      const target = alias.exec(value)?.[1];
      if (!target) {
        resolved.set(current, value);
        break;
      }
      chain.add(current);
      current = target;
    }
    const value = resolved.get(current)!;
    for (const member of chain) resolved.set(member, value);
  }
  return [...declarations].map(([cssName, value]) => ({
    cssName,
    value,
    resolved: resolved.get(cssName)!,
  }));
}

export function tokenType(resolved: string) {
  if (color(resolved)) return "Color";
  const unit = measured.exec(resolved)?.[2];
  if (unit) return unit === "s" || unit === "ms" ? "Duration" : "Dimension";
  if (unitless.test(resolved)) return "Unitless";
  return "Value";
}

export function copyFormats({ cssName, resolved }: SharedToken) {
  const formats = [
    { name: "CSS variable", value: `var(${cssName})` },
    { name: "CSS value", value: resolved },
  ];
  const resource = cssName.slice(2).replaceAll("-", "_");
  const rgba = color(resolved);
  if (rgba) {
    const { red, green, blue, opacity } = rgba;
    const swiftChannel = (byte: number) => Number((Math.min(byte, 255) / 255).toFixed(6));
    const hexByte = (byte: number) => Math.min(255, Math.round(byte)).toString(16).padStart(2, "0");
    const argb = [opacity * 255, red, green, blue].map(hexByte).join("").toUpperCase();
    formats.push(
      {
        name: "SwiftUI color",
        value: `Color(.sRGB, red: ${swiftChannel(red)}, green: ${swiftChannel(green)}, blue: ${swiftChannel(blue)}, opacity: ${Number(opacity.toFixed(6))})`,
      },
      { name: "Android color XML", value: `<color name="${resource}">#${argb}</color>` },
    );
  } else {
    const measure = measured.exec(resolved);
    const amount = Number(measure?.[1]);
    if (Number.isFinite(amount) && amount >= 0 && (measure?.[2] === "ms" || measure?.[2] === "s")) {
      const seconds = measure[2] === "s" ? amount : amount / 1000;
      const milliseconds = measure[2] === "ms" ? amount : Math.round(amount * 1000);
      const wholeMilliseconds =
        measure[2] === "ms" ? Number.isInteger(milliseconds) : milliseconds / 1000 === amount;
      formats.push({ name: "Swift duration", value: `Duration.seconds(${seconds})` });
      if (wholeMilliseconds && milliseconds <= 2147483647)
        formats.push({
          name: "Android duration XML",
          value: `<integer name="${resource}">${milliseconds}</integer>`,
        });
    }
  }
  return formats;
}
