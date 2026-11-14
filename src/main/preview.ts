import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, protocol, type Session, type WebContents } from "electron";
import { defaultTreeAdapter, parse, serialize, type DefaultTreeAdapterTypes } from "parse5";
import type { Artboard, Source } from "../shared/model";
import { Project, ProjectError, type Snapshot } from "./project";

export const chromeUrl = "easy-proto://ui/index.html";
const chromeOrigin = "easy-proto://ui";
const artOrigin = "easy-art://preview";
const renderOrigin = "easy-proto://capture";
const schemeOptions = { standard: true, secure: true, supportFetchAPI: true };
protocol.registerSchemesAsPrivileged([
  { scheme: "easy-proto", privileges: schemeOptions },
  { scheme: "easy-art", privileges: schemeOptions },
]);

export const securePreferences = {
  nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true,
  sandbox: true, webSecurity: true, webviewTag: false, backgroundThrottling: false,
} as const;

const removedTags = new Set([
  "script", "iframe", "frame", "frameset", "fencedframe", "object", "embed", "applet", "portal",
  "base", "link", "meta", "noscript", "template", "audio", "video", "track",
]);
const removedAttributes = new Set([
  "autofocus", "ping", "target", "srcdoc", "action", "formaction", "download",
  "attributionsrc", "imagesrcset", "imagesizes",
]);

function previewHtml(html: string) {
  const parsed = parse(html, { scriptingEnabled: false });
  function clean(parent: DefaultTreeAdapterTypes.ParentNode) {
    parent.childNodes = parent.childNodes.filter((child) => {
      if (!("tagName" in child)) return true;
      if (removedTags.has(child.tagName)) return false;
      child.attrs = child.attrs.filter(({ name }) => !name.startsWith("on") && !removedAttributes.has(name));
      clean(child);
      return true;
    });
  }
  clean(parsed);
  const root = parsed.childNodes.find((child) => defaultTreeAdapter.isElementNode(child));
  const head = root?.childNodes.find((child) => defaultTreeAdapter.isElementNode(child) && child.tagName === "head");
  if (!head || !defaultTreeAdapter.isElementNode(head)) throw new Error("Preview HTML has no head.");
  const stylesheet = defaultTreeAdapter.createElement("link", head.namespaceURI, [
    { name: "rel", value: "stylesheet" }, { name: "href", value: "./board.css" },
  ]);
  if (head.childNodes.length) defaultTreeAdapter.insertBefore(head, stylesheet, head.childNodes[0]);
  else defaultTreeAdapter.appendChild(head, stylesheet);
  defaultTreeAdapter.setDocumentType(parsed, "html", "", "");
  return serialize(parsed);
}

type Surface = {
  project: Project;
  board: Artboard;
  source: Source;
  missing: Set<string>;
};

function reply(body: BodyInit, type: string, policy?: string) {
  const headers = new Headers({
    "Content-Type": type, "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "X-DNS-Prefetch-Control": "off",
  });
  if (policy) headers.set("Content-Security-Policy", policy);
  return new Response(body, { headers });
}

const chromeMime = new Map([[".js", "text/javascript"], [".css", "text/css"], [".html", "text/html; charset=utf-8"]]);

function timeout<T>(work: Promise<T>, ms: number, message: string, code = "RENDER_TIMEOUT"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProjectError(code, message)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

const inspectFrame = `(async () => {
  const problems = new Set();
  const images = [...document.images];
  for (const image of images) image.loading = "eager";
  await Promise.all([document.fonts.ready, ...images.map(image => image.decode().catch(() => {
    problems.add("Image failed to decode");
  }))]);
  for (const font of document.fonts) {
    if (font.status === "error") problems.add("Font could not load: " + font.family);
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { viewport: [innerWidth, innerHeight], problems: [...problems] };
})()`;

type Readiness = { viewport: number[]; problems: string[] };

async function inspect(contents: WebContents, url: string): Promise<Readiness> {
  const debuggerClient = contents.debugger;
  debuggerClient.attach("1.3");
  try {
    const { targetInfos } = await debuggerClient.sendCommand("Target.getTargets");
    const target = targetInfos.find((candidate: { type: string; url: string }) =>
      candidate.type === "iframe" && candidate.url === url);
    const sessionId = target
      ? (await debuggerClient.sendCommand("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId
      : undefined;
    const { frameTree } = await debuggerClient.sendCommand("Page.getFrameTree", {}, sessionId);
    const frameId = frameTree.frame.url === url ? frameTree.frame.id
      : frameTree.childFrames?.find((child: { frame: { url: string } }) => child.frame.url === url)?.frame.id;
    if (!frameId) throw new ProjectError("RENDER_FAILED", "Chromium could not inspect the loaded artboard frame.");
    const { executionContextId } = await debuggerClient.sendCommand("Page.createIsolatedWorld", {
      frameId, worldName: "Easy Proto capture readiness",
    }, sessionId);
    const evaluated = await debuggerClient.sendCommand("Runtime.evaluate", {
      expression: inspectFrame, contextId: executionContextId, awaitPromise: true, returnByValue: true,
    }, sessionId);
    if (evaluated.exceptionDetails || !evaluated.result.value) {
      throw new ProjectError("RENDER_FAILED", "Chromium could not verify font and image readiness.");
    }
    return evaluated.result.value as Readiness;
  } finally {
    if (debuggerClient.isAttached()) debuggerClient.detach();
  }
}

export class Preview {
  #live = new Map<string, Surface>();
  #captures = new Map<string, Surface>();
  #captureQueue = Promise.resolve();
  #pendingCaptures = 0;

  constructor(private readonly session: Session) {}

  async install(chromeDir: string) {
    const chromeFiles = new Map<string, { bytes: Buffer; mime: string }>();
    const files = ["index.html", ...(await readdir(join(chromeDir, "assets"))).map((name) => "assets/" + name)];
    for (const file of files) {
      const mime = chromeMime.get(file.slice(file.lastIndexOf(".")));
      if (mime) chromeFiles.set("/" + file, { bytes: await readFile(join(chromeDir, file)), mime });
    }
    this.session.protocol.handle("easy-proto", (request) => {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.search) return new Response(null, { status: 404 });
      if (url.host === "ui") {
        const file = chromeFiles.get(url.pathname);
        if (file) return reply(new Uint8Array(file.bytes), file.mime,
          `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src ${artOrigin}; img-src 'self' data:; base-uri 'none'; form-action 'none'`);
      }
      if (url.host === "capture") {
        const key = url.pathname.slice(1);
        if (this.#captures.has(key)) {
          return reply(`<!doctype html><style>html,body{margin:0;overflow:hidden}iframe{display:block;width:100vw;height:100vh;border:0}</style><iframe sandbox="" src="${artOrigin}/${key}/index.html"></iframe>`,
            "text/html; charset=utf-8", `default-src 'none'; style-src 'unsafe-inline'; frame-src ${artOrigin}; base-uri 'none'`);
        }
      }
      return new Response(null, { status: 404 });
    });

    this.session.protocol.handle("easy-art", (request) => {
      const url = new URL(request.url);
      const [, key, resource, ...parts] = url.pathname.split("/");
      const preview = this.#live.get(key) ?? this.#captures.get(key);
      if (request.method !== "GET" || url.host !== "preview" || url.search || !preview) {
        return new Response(null, { status: 404 });
      }
      if (!parts.length && resource === "index.html") {
        const base = `${artOrigin}/${key}/`;
        return reply(previewHtml(preview.source.html), "text/html; charset=utf-8",
          `sandbox; default-src 'none'; style-src 'unsafe-inline' ${base}board.css; img-src ${base}assets/ data:; font-src ${base}assets/; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'`);
      }
      if (!parts.length && resource === "board.css") return reply(preview.source.css, "text/css; charset=utf-8");
      if (resource === "assets") {
        let assetPath: string;
        try {
          const names = parts.map((part) => decodeURIComponent(part));
          if (names.some((name) => !name || name === "." || name === ".." || /[/\\\u0000-\u001f]/.test(name))) {
            return new Response(null, { status: 404 });
          }
          assetPath = names.join("/");
        } catch {
          return new Response(null, { status: 400 });
        }
        const asset = preview.project.assets.get(assetPath);
        if (asset) {
          const response = reply(new Uint8Array(asset.bytes), asset.mime);
          if (asset.mime.startsWith("font/")) response.headers.set("Access-Control-Allow-Origin", "*");
          return response;
        }
        preview.missing.add(assetPath);
      }
      return new Response(null, { status: 404 });
    });

    this.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    this.session.setPermissionCheckHandler(() => false);
    this.session.on("will-download", (event) => event.preventDefault());
    this.session.webRequest.onBeforeRequest((details, callback) => {
      const { url } = details;
      const permitted = url.startsWith(chromeOrigin + "/") || url.startsWith(renderOrigin + "/") ||
        url.startsWith(artOrigin + "/") || url.startsWith("data:image/");
      callback({ cancel: !permitted });
    });
  }

  protect(contents: WebContents, captureUrl?: string) {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("will-redirect", (event) => event.preventDefault());
    contents.on("will-frame-navigate", (event) => {
      const { url, isMainFrame, frame } = event;
      if (isMainFrame || frame?.parent !== contents.mainFrame) {
        event.preventDefault();
        return;
      }
      const key = /^easy-art:\/\/preview\/([a-zA-Z0-9-]+)\/index\.html$/.exec(url)?.[1];
      const allowed = key && (captureUrl ? captureUrl === renderOrigin + "/" + key : this.#live.has(key));
      if (!allowed) event.preventDefault();
    });
  }

  scene(project: Project) {
    const { manifest, sources } = project.snapshot;
    const active = new Map<string, Surface>();
    const artboards = manifest.artboards.map((board) => {
      const key = `${board.id}-${board.sourceRevision}-${project.assetDigest}`;
      active.set(key, this.#live.get(key) ?? { project, board, source: sources.get(board.id)!, missing: new Set() });
      return { ...board, previewUrl: `${artOrigin}/${key}/index.html` };
    });
    this.#live = active;
    return { projectId: manifest.projectId, revision: manifest.revision, artboards };
  }

  capture(project: Project, snapshot: Snapshot, board: Artboard) {
    if (this.#pendingCaptures >= 4) throw new ProjectError("CAPTURE_BUSY", "The capture queue is full. Try again shortly.");
    this.#pendingCaptures++;
    const job = this.#captureQueue.then(() => this.#capture(project, snapshot, board)).finally(() => {
      this.#pendingCaptures--;
    });
    this.#captureQueue = job.then(() => undefined, () => undefined);
    return job;
  }

  async #capture(project: Project, snapshot: Snapshot, board: Artboard) {
    const key = randomUUID();
    const { width, height } = board;
    const surface = { project, board, source: snapshot.sources.get(board.id)!, missing: new Set<string>() };
    this.#captures.set(key, surface);
    const renderUrl = `${renderOrigin}/${key}`;
    const boardUrl = `${artOrigin}/${key}/index.html`;
    const window = new BrowserWindow({
      width, height, useContentSize: true, frame: false, show: false, enableLargerThanScreen: true,
      webPreferences: { ...securePreferences, session: this.session },
    });
    const { webContents } = window;
    const blockedResources = new Set<string>();
    webContents.on("console-message", (details) => {
      if (/content security policy/i.test(details.message)) blockedResources.add("A resource was blocked by preview policy.");
    });
    this.protect(webContents, renderUrl);
    try {
      await timeout(window.loadURL(renderUrl), 5000, "The artboard did not load within 5 seconds.");
      const frame = webContents.mainFrame.frames.find((candidate) => candidate.url === boardUrl);
      if (!frame) throw new ProjectError("RENDER_FAILED", "The requested artboard frame did not load.");
      const report = await timeout(
        inspect(webContents, boardUrl), 5000, "Fonts, images or paint did not settle within 5 seconds.");
      if (frame.url !== boardUrl || report.viewport[0] !== width || report.viewport[1] !== height) {
        throw new ProjectError("RENDER_MISMATCH", "Chromium did not render the requested revision and CSS viewport.");
      }
      const image = await timeout(webContents.capturePage({ x: 0, y: 0, width, height }, { stayHidden: true }),
        5000, "Chromium did not finish capturing the rendered artboard.", "CAPTURE_TIMEOUT");
      if (image.isEmpty()) throw new ProjectError("CAPTURE_FAILED", "Chromium returned an empty screenshot.");
      const nativePng = image.toPNG();
      const nativeWidth = nativePng.readUInt32BE(16);
      const nativeHeight = nativePng.readUInt32BE(20);
      const needsResize = nativeWidth !== width || nativeHeight !== height;
      const png = needsResize ? image.resize({ width, height, quality: "best" }).toPNG() : nativePng;
      const pixelWidth = png.readUInt32BE(16);
      const pixelHeight = png.readUInt32BE(20);
      if (pixelWidth !== width || pixelHeight !== height) {
        throw new ProjectError("CAPTURE_MISMATCH", "The PNG pixel dimensions did not match the requested viewport.");
      }
      return {
        png,
        details: {
          status: "captured", rendered: true, projectId: snapshot.manifest.projectId,
          revision: snapshot.manifest.revision, artboardId: board.id, sourceRevision: board.sourceRevision,
          sourceDigest: board.sourceDigest, assetDigest: project.assetDigest, chromium: process.versions.chrome,
          width, height, pixelWidth, pixelHeight, nativeWidth, nativeHeight,
          unresolved: [...report.problems, ...blockedResources, ...[...surface.missing].map((name) => `Missing asset: ${name}`)],
        },
      };
    } finally {
      this.#captures.delete(key);
      if (!window.isDestroyed()) window.destroy();
    }
  }
}
