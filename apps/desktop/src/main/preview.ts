import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, nativeImage, protocol, type Session, type WebContents } from "electron";
import { previewHtml } from "@easy-proto/preview";
import type { Artboard, Source } from "../shared/model";
import { Project, ProjectError, type Snapshot } from "./project";

export const chromeUrl = "easy-proto://ui/index.html";
const chromeOrigin = "easy-proto://ui";
const artOrigin = "easy-art://preview";
const schemeOptions = { standard: true, secure: true, supportFetchAPI: true };
protocol.registerSchemesAsPrivileged([
  { scheme: "easy-proto", privileges: schemeOptions },
  { scheme: "easy-art", privileges: schemeOptions },
]);

export const securePreferences = {
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  webviewTag: false,
  backgroundThrottling: false,
} as const;

type Surface = {
  project: Project;
  board: Artboard;
  source: Source;
  tokenCss?: string;
  missing: Set<string>;
  used: Set<string>;
};

function reply(body: BodyInit, type: string, policy?: string) {
  const headers = new Headers({
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-DNS-Prefetch-Control": "off",
  });
  if (policy) headers.set("Content-Security-Policy", policy);
  return new Response(body, { headers });
}

const chromeMime = new Map([
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".html", "text/html; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

function timeout<T>(
  work: Promise<T>,
  ms: number,
  message: string,
  code = "RENDER_TIMEOUT",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProjectError(code, message)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

const inspectFrame = `(async (hasTokens) => {
  const problems = new Set();
  const images = [...document.images];
  const styleUrls = new Set();
  const resource = /url\\("([^"]*)"\\)/g;
  for (const element of document.querySelectorAll("*")) {
    for (const pseudo of [null, "::before", "::after", "::marker"]) {
      const style = getComputedStyle(element, pseudo);
      for (const value of [style.backgroundImage, style.maskImage, style.borderImageSource, style.listStyleImage, style.content]) {
        for (const match of value.matchAll(resource)) styleUrls.add(match[1]);
      }
    }
  }
  const cssImages = [...styleUrls].map(url => {
    const image = new Image();
    image.src = url;
    return image.decode().catch(() => {
      const assetPrefix = new URL("./assets/", document.URL).href;
      const path = url.startsWith(assetPrefix) ? url.slice(assetPrefix.length) : "";
      problems.add(path ? "CSS image failed to decode: " + path : "CSS image failed to decode");
    });
  });
  const htmlImages = images.map(image => image.decode().catch(() => problems.add("Image failed to decode")));
  await Promise.all([document.fonts.ready, ...htmlImages, ...cssImages]);
  const tokenUrl = new URL("./tokens.css", document.URL).href;
  const tokensLoaded = hasTokens
    ? [...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === tokenUrl && link.sheet)
    : true;
  for (const font of document.fonts) {
    if (font.status === "error") problems.add("Font could not load: " + font.family);
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const media = {};
  for (const [name, values] of Object.entries({
    "prefers-color-scheme": ["dark", "light"],
    "prefers-reduced-motion": ["reduce", "no-preference"],
    "prefers-contrast": ["more", "less", "custom", "no-preference"],
    "prefers-reduced-transparency": ["reduce", "no-preference"],
    "forced-colors": ["active", "none"],
  })) {
    media[name] = values.find(value => matchMedia("(" + name + ": " + value + ")").matches) ?? "unavailable";
  }
  return { viewport: [innerWidth, innerHeight], problems: [...problems], tokensLoaded, media, devicePixelRatio };
})`;

type Readiness = {
  viewport: number[];
  problems: string[];
  tokensLoaded: boolean;
  media: Record<string, string>;
  devicePixelRatio: number;
};

async function inspect(contents: WebContents, url: string, hasTokens: boolean): Promise<Readiness> {
  const debuggerClient = contents.debugger;
  const { frameTree } = await debuggerClient.sendCommand("Page.getFrameTree");
  if (frameTree.frame.url !== url)
    throw new ProjectError("RENDER_FAILED", "Chromium could not inspect the loaded artboard.");
  const frameId = frameTree.frame.id;
  const { executionContextId } = await debuggerClient.sendCommand("Page.createIsolatedWorld", {
    frameId,
    worldName: "Easy Proto capture readiness",
  });
  const evaluated = await debuggerClient.sendCommand("Runtime.evaluate", {
    expression: `${inspectFrame}(${hasTokens})`,
    contextId: executionContextId,
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluated.exceptionDetails || !evaluated.result.value) {
    throw new ProjectError("RENDER_FAILED", "Chromium could not verify font and image readiness.");
  }
  return evaluated.result.value as Readiness;
}

export class Preview {
  #live = new Map<string, Surface>();
  #captures = new Map<string, Surface>();
  #captureQueue = Promise.resolve();
  #pendingCaptures = 0;

  constructor(private readonly session: Session) {}

  async install(chromeDir: string) {
    const chromeFiles = new Map<string, { bytes: Buffer; mime: string }>();
    const files = [
      "index.html",
      ...(await readdir(join(chromeDir, "assets"))).map((name) => "assets/" + name),
    ];
    for (const file of files) {
      const mime = chromeMime.get(file.slice(file.lastIndexOf(".")));
      if (mime) chromeFiles.set("/" + file, { bytes: await readFile(join(chromeDir, file)), mime });
    }
    this.session.protocol.handle("easy-proto", (request) => {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.search) return new Response(null, { status: 404 });
      if (url.host === "ui") {
        const file = chromeFiles.get(url.pathname);
        if (file)
          return reply(
            new Uint8Array(file.bytes),
            file.mime,
            `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-src ${artOrigin}; img-src 'self' data:; base-uri 'none'; form-action 'none'`,
          );
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
        const tokenPolicy = preview.tokenCss ? ` ${base}tokens.css` : "";
        return reply(
          previewHtml(preview.source.html, Boolean(preview.tokenCss)),
          "text/html; charset=utf-8",
          `sandbox; default-src 'none'; style-src 'unsafe-inline' ${base}board.css${tokenPolicy}; img-src ${base}assets/ data:; font-src ${base}assets/; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'`,
        );
      }
      if (!parts.length && resource === "board.css")
        return reply(preview.source.css, "text/css; charset=utf-8");
      if (!parts.length && resource === "tokens.css" && preview.tokenCss)
        return reply(preview.tokenCss, "text/css; charset=utf-8");
      if (resource === "assets") {
        let assetPath: string;
        try {
          const names = parts.map((part) => decodeURIComponent(part));
          if (
            names.some(
              // Reject decoded path separators and control characters before asset lookup.
              // oxlint-disable-next-line no-control-regex
              (name) => !name || name === "." || name === ".." || /[/\\\u0000-\u001f]/.test(name),
            )
          ) {
            return new Response(null, { status: 404 });
          }
          assetPath = names.join("/");
        } catch {
          return new Response(null, { status: 400 });
        }
        const asset = preview.project.assets.get(assetPath);
        if (asset) {
          preview.used.add(assetPath);
          const response = reply(new Uint8Array(asset.bytes), asset.mime);
          if (asset.mime.startsWith("font/"))
            response.headers.set("Access-Control-Allow-Origin", "*");
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
      const permitted =
        url.startsWith(chromeOrigin + "/") ||
        url.startsWith(artOrigin + "/") ||
        url.startsWith("data:image/");
      callback({ cancel: !permitted });
    });
  }

  protect(contents: WebContents, capturing = false) {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("will-redirect", (event) => event.preventDefault());
    contents.on("will-frame-navigate", (event) => {
      const { url, isMainFrame, frame } = event;
      if (capturing || isMainFrame || frame?.parent !== contents.mainFrame) {
        event.preventDefault();
        return;
      }
      const key = /^easy-art:\/\/preview\/([a-zA-Z0-9-]+)\/index\.html$/.exec(url)?.[1];
      const allowed = key && this.#live.has(key);
      if (!allowed) event.preventDefault();
    });
  }

  scene(project: Project, generation: number) {
    const { manifest, sources, tokens } = project.snapshot;
    const tokenKey = tokens?.css ? `-${tokens.stamp.cssDigest}` : "";
    const active = new Map<string, Surface>();
    const artboards = manifest.artboards.map((board) => {
      const key = `${generation}-${board.id}-${board.sourceRevision}-${project.assetDigest}${tokenKey}`;
      active.set(
        key,
        this.#live.get(key) ?? {
          project,
          board,
          source: sources.get(board.id)!,
          tokenCss: tokens?.css,
          missing: new Set(),
          used: new Set(),
        },
      );
      return { ...board, previewUrl: `${artOrigin}/${key}/index.html` };
    });
    this.#live = active;
    return { generation, projectId: manifest.projectId, revision: manifest.revision, artboards };
  }

  clearLive() {
    this.#live.clear();
  }

  async capture(project: Project, snapshot: Snapshot, board: Artboard, signal: AbortSignal) {
    if (this.#pendingCaptures >= 4)
      throw new ProjectError("CAPTURE_BUSY", "The capture queue is full. Try again shortly.");
    this.#pendingCaptures++;
    const job = this.#captureQueue
      .then(() => {
        signal.throwIfAborted();
        return this.#capture(project, snapshot, board, signal);
      })
      .finally(() => {
        this.#pendingCaptures--;
      });
    this.#captureQueue = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  async #capture(project: Project, snapshot: Snapshot, board: Artboard, signal: AbortSignal) {
    const key = randomUUID();
    const { width, height } = board;
    const surface = {
      project,
      board,
      source: snapshot.sources.get(board.id)!,
      tokenCss: snapshot.tokens?.css,
      missing: new Set<string>(),
      used: new Set<string>(),
    };
    const boardUrl = `${artOrigin}/${key}/index.html`;
    const window = new BrowserWindow({
      width,
      height,
      useContentSize: true,
      frame: false,
      show: false,
      enableLargerThanScreen: true,
      webPreferences: { ...securePreferences, session: this.session },
    });
    const { webContents } = window;
    const close = () => {
      this.#captures.delete(key);
      if (window.isDestroyed()) return;
      if (webContents.debugger.isAttached()) webContents.debugger.detach();
      window.destroy();
    };
    this.#captures.set(key, surface);
    signal.addEventListener("abort", close, { once: true });
    const blockedResources = new Set<string>();
    webContents.on("console-message", (details) => {
      if (/content security policy/i.test(details.message))
        blockedResources.add("A resource was blocked by preview policy.");
    });
    this.protect(webContents, true);
    try {
      await timeout(window.loadURL(boardUrl), 5000, "The artboard did not load within 5 seconds.");
      const frame = webContents.mainFrame;
      if (frame.url !== boardUrl)
        throw new ProjectError("RENDER_FAILED", "The requested artboard did not load.");
      webContents.debugger.attach("1.3");
      const report = await timeout(
        inspect(webContents, boardUrl, Boolean(surface.tokenCss)),
        5000,
        "Fonts, images or paint did not settle within 5 seconds.",
      );
      if (!report.tokensLoaded)
        throw new ProjectError(
          "RENDER_FAILED",
          "Chromium did not load the committed token stylesheet.",
        );
      if (frame.url !== boardUrl || report.viewport[0] !== width || report.viewport[1] !== height) {
        throw new ProjectError(
          "RENDER_MISMATCH",
          "Chromium did not render the requested revision and CSS viewport.",
        );
      }
      const shot = await timeout(
        webContents.debugger.sendCommand("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        }),
        5000,
        "Chromium did not finish capturing the rendered artboard.",
        "CAPTURE_TIMEOUT",
      );
      const image = nativeImage.createFromBuffer(Buffer.from(shot.data, "base64"));
      if (image.isEmpty())
        throw new ProjectError("CAPTURE_FAILED", "Chromium returned an empty screenshot.");
      const nativePng = image.toPNG();
      const nativeWidth = nativePng.readUInt32BE(16);
      const nativeHeight = nativePng.readUInt32BE(20);
      const needsResize = nativeWidth !== width || nativeHeight !== height;
      const png = needsResize
        ? image.resize({ width, height, quality: "best" }).toPNG()
        : nativePng;
      const pixelWidth = png.readUInt32BE(16);
      const pixelHeight = png.readUInt32BE(20);
      if (pixelWidth !== width || pixelHeight !== height) {
        throw new ProjectError(
          "CAPTURE_MISMATCH",
          "The PNG pixel dimensions did not match the requested viewport.",
        );
      }
      return {
        png,
        details: {
          status: "captured",
          rendered: true,
          projectId: snapshot.manifest.projectId,
          revision: snapshot.manifest.revision,
          artboardId: board.id,
          sourceRevision: board.sourceRevision,
          sourceDigest: board.sourceDigest,
          ...(snapshot.tokens ? { tokens: snapshot.tokens.stamp } : {}),
          assetDigest: project.assetDigest,
          chromium: process.versions.chrome,
          width,
          height,
          pixelWidth,
          pixelHeight,
          nativeWidth,
          nativeHeight,
          media: report.media,
          devicePixelRatio: report.devicePixelRatio,
          unresolved: [
            ...report.problems,
            ...blockedResources,
            ...[...surface.missing].map((name) => `Missing asset: ${name}`),
          ],
          assets: [...surface.used].sort(),
        },
      };
    } finally {
      signal.removeEventListener("abort", close);
      close();
    }
  }
}
