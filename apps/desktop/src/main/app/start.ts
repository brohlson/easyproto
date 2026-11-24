import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { app, BrowserWindow, dialog, Menu, nativeTheme, session } from "electron";
import { ipc, type DesktopState } from "../../shared/model";
import { colorToHex } from "../../shared/token-types";
import desktopTokens from "../../renderer/design.tokens.json";
import { Project, ProjectError } from "../document/project";
import { RecentProjects } from "../document/recent-projects";
import { parseTokenDocument } from "../document/tokens";
import { listen, type ActiveProject } from "../mcp/server";
import { environmentMcpSettings, readLocalMcpSettings } from "../mcp/settings";
import { ArtboardActivity } from "../previews/activity";
import { chromeUrl, Preview, securePreferences } from "../previews/preview";
import { readWebPreviewSettings } from "../publishing/web-preview";
import { registerIpc } from "./ipc";

export async function start({
  projectOption,
  launchDirectory,
  testProfile,
}: {
  projectOption: string | undefined;
  launchDirectory: string;
  testProfile: string | undefined;
}) {
  const recent = await RecentProjects.load(join(app.getPath("userData"), "recent-projects.json"));
  let active: ActiveProject | undefined;
  if (projectOption) {
    try {
      active = activate(await Project.open(resolve(launchDirectory, projectOption)));
      await remember(active.project, true);
    } catch {
      throw new Error(
        "Easy Proto could not open the selected project. Use a project folder or .easyproto file with --project=PATH.",
      );
    }
  } else if (!recent.list().length) {
    const legacy = await Project.open(
      join(app.getPath("userData"), "Projects", "Untitled"),
      undefined,
      "open",
    ).catch(() => undefined);
    if (legacy) await remember(legacy);
  }
  function activate(project: Project): ActiveProject {
    const lifetime = new AbortController();
    const activationId = randomUUID();
    return {
      project,
      activationId,
      signal: lifetime.signal,
      activity: new ArtboardActivity(
        lifetime.signal,
        changed,
        desktopTokens.desktop.motion["working-minimum"].$value.value,
      ),
      retire: () => lifetime.abort(),
    };
  }
  async function remember(project: Project, findMoved = false) {
    if (!(await recent.remember(project, findMoved)))
      console.warn("Could not save the recent projects list.");
  }
  let generation = 0;
  let sceneVersion = 0;
  let switching = false;
  const isolatedSession = session.fromPartition("easy-proto");
  const preview = new Preview(isolatedSession);
  await preview.install(join(app.getAppPath(), "dist", "ui"));
  const theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  const chromeColor = parseTokenDocument(JSON.stringify(desktopTokens)).rows.find(
    ({ path }) => path === `desktop.${theme}.background`,
  )?.resolved;
  if (typeof chromeColor !== "object" || !("colorSpace" in chromeColor))
    throw new Error("The desktop background token is missing.");
  const window = new BrowserWindow({
    title: "Easy Proto",
    width: 1180,
    height: 770,
    minWidth: 660,
    minHeight: 480,
    show: false,
    backgroundColor: colorToHex(chromeColor),
    webPreferences: {
      ...securePreferences,
      session: isolatedSession,
      preload: join(app.getAppPath(), "dist", "preload.cjs"),
    },
  });
  preview.protect(window.webContents);
  const webSettings = await readWebPreviewSettings(
    app.isPackaged ? undefined : resolve(app.getAppPath(), "../../.local/web-preview.json"),
  ).catch(() => {
    console.warn(
      "Local web preview settings are unavailable. Check the development configuration.",
    );
    return undefined;
  });
  function scene(): DesktopState {
    const projects = recent.list();
    if (!active) return { view: "home", sceneVersion, projects };
    const { project, activity } = active;
    const snapshot = preview.scene(project, generation);
    const pageLayout = project.pageLayout;
    return {
      ...snapshot,
      ...pageLayout,
      view: "project",
      sceneVersion,
      name: project.name,
      agentFocus: activity.focus,
      tokenDigest: project.snapshot.tokens?.stamp.documentDigest,
      canUndo: project.canUndo,
      canRedo: project.canRedo,
      projects,
      artboards: snapshot.artboards.map((board) => ({
        ...board,
        pageId: board.pageId ?? pageLayout.defaultPageId,
        agentWorking: activity.isPresenting(board.id),
      })),
    };
  }
  function changed() {
    if (window.isDestroyed()) return;
    sceneVersion++;
    const next = scene();
    try {
      window.webContents.send(ipc.changed, next);
    } catch {
      // A renderer that is closing can reload the authoritative scene on next launch.
    }
  }

  function checkWritable() {
    if (switching)
      throw new ProjectError(
        "PROJECT_SWITCHING",
        "The project is switching. Call get_context and try again.",
      );
  }

  async function switchTo(load: () => Promise<Project | undefined>, findMoved = false) {
    switching = true;
    try {
      await active?.project.whenIdle();
      if (window.isDestroyed()) return;
      const next = await load();
      if (window.isDestroyed()) return;
      const previous = active;
      active = next ? activate(next) : undefined;
      generation++;
      previous?.retire();
      preview.clearLive();
      if (next) await remember(next, findMoved);
      changed();
    } finally {
      switching = false;
    }
  }

  registerIpc({
    window,
    recent,
    state: {
      get active() {
        return active;
      },
      get generation() {
        return generation;
      },
      get switching() {
        return switching;
      },
    },
    switchTo,
    checkWritable,
    remember,
    scene,
    changed,
    preview,
    webSettings,
  });

  const useSavedSettings =
    app.isPackaged &&
    process.platform === "darwin" &&
    !testProfile &&
    process.env.EASY_PROTO_TOKEN === undefined &&
    process.env.EASY_PROTO_PORT === undefined;
  let connectionWarning: string | undefined;
  try {
    const connection = useSavedSettings
      ? await readLocalMcpSettings(app.getPath("userData"))
      : environmentMcpSettings(process.env);
    if (connection) {
      const endpoint = await listen(
        () => active,
        preview,
        changed,
        checkWritable,
        connection.port,
        connection.token,
      );
      console.log("Easy Proto MCP listening at", endpoint.url);
      app.once("will-quit", endpoint.stop);
    }
  } catch (error) {
    if (!useSavedSettings) throw error;
    connectionWarning =
      (error as NodeJS.ErrnoException).code === "EADDRINUSE"
        ? "The configured MCP port is already in use. Quit the other listener and reopen Easy Proto."
        : "Check the token, port, and file permissions in local-mcp.json, then reopen Easy Proto.";
    console.warn("Local MCP is unavailable.", connectionWarning);
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]),
  );
  window.on("closed", () => {
    active?.retire();
  });
  window.once("ready-to-show", () => window.show());
  await window.loadURL(chromeUrl);
  if (connectionWarning && !window.isDestroyed())
    void dialog.showMessageBox(window, {
      type: "warning",
      message: "Local MCP is unavailable",
      detail: connectionWarning,
    });
}
