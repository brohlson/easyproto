import { BrowserWindow, nativeImage } from "electron";
import { securePreferences } from "./preview";
import { ProjectError } from "../document/project";

const cellWidth = 240;
const cellHeight = 216;

export function thumbnail(png: Buffer, width: number, height: number) {
  const scale = Math.min(224 / width, 168 / height, 1);
  const resized = nativeImage.createFromBuffer(png).resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  });
  const bytes = resized.toPNG();
  // Keep the sheet's data URL bounded even for twelve photographic thumbnails.
  return bytes.length <= 96 * 1024
    ? "data:image/png;base64," + bytes.toString("base64")
    : "data:image/jpeg;base64," + resized.toJPEG(85).toString("base64");
}

type Tile = { name: string; image: string; warning: boolean };

export async function reviewSheet(tiles: Tile[], signal: AbortSignal) {
  signal.throwIfAborted();
  const columns = Math.min(tiles.length, Math.ceil(Math.sqrt(tiles.length)));
  const width = columns * cellWidth;
  const height = Math.ceil(tiles.length / columns) * cellHeight;
  const cards = tiles.map(({ name, image, warning }, i) => {
    const label = name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return `<article><div><img src="${image}"></div><b>${i + 1}. ${label}</b><small>${warning ? "Check render diagnostics" : ""}</small></article>`;
  });
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>*{box-sizing:border-box}body{margin:0;background:#edf0f2;color:#17232b;font:14px system-ui;display:grid;grid-template-columns:repeat(${columns},${cellWidth}px)}
article{height:${cellHeight}px;padding:6px 8px}div{height:168px;background:white;display:grid;place-items:center}b,small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}b{margin-top:3px}small{color:#9a3e00}</style>${cards.join("")}`;
  const window = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: { ...securePreferences, javascript: false },
  });
  const close = () => {
    if (!window.isDestroyed()) window.destroy();
  };
  signal.addEventListener("abort", close, { once: true });
  const timer = setTimeout(close, 10000);
  try {
    await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    window.webContents.debugger.attach("1.3");
    const screenshot = await window.webContents.debugger.sendCommand("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    const image = nativeImage.createFromBuffer(Buffer.from(screenshot.data, "base64"));
    if (image.isEmpty()) throw new ProjectError("CAPTURE_FAILED", "The review sheet was empty.");
    return image.resize({ width, height }).toPNG().toString("base64");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", close);
    close();
  }
}
