import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  Menu,
  nativeTheme,
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  type IpcMainInvokeEvent,
} from "electron";
import { z } from "zod";
import {
  commandSchema,
  desktopArtboardPatch,
  id,
  ipc,
  projectName,
  type DesktopState,
} from "../shared/model";
import { ArtboardActivity } from "./activity";
import { listen, type ActiveProject } from "./mcp";
import { chromeUrl, Preview, securePreferences } from "./preview";
import { Project, ProjectError } from "./project";
import { RecentProjects } from "./recent-projects";

const projectOption = process.argv
  .find((arg) => arg.startsWith("--project="))
  ?.slice("--project=".length);
const testProfile = process.env.EASY_PROTO_PROFILE;
if (testProfile) app.setPath("userData", resolve(testProfile));

function allowSender(event: IpcMainInvokeEvent, window: BrowserWindow) {
  if (
    event.sender !== window.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== chromeUrl
  )
    throw new Error("Only the application window can use this command.");
}

async function start() {
  const recent = await RecentProjects.load(join(app.getPath("userData"), "recent-projects.json"));
  let active: ActiveProject | undefined;
  if (projectOption) {
    try {
      active = activate(await Project.open(resolve(projectOption)));
      await remember(active.project, true);
    } catch {
      throw new Error(
        "Easy Proto could not open this folder. Choose a valid project or an empty folder with --project=PATH.",
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
    return {
      project,
      activationId: randomUUID(),
      signal: lifetime.signal,
      activity: new ArtboardActivity(lifetime.signal, changed),
      retire: () => lifetime.abort(),
    };
  }
  async function remember(project: Project, findMoved = false) {
    if (!(await recent.remember(project, findMoved)))
      console.warn("Could not save the recent projects list.");
  }
  let generation = 0;
  let sceneVersion = 0;
  let choosing = false;
  let switching = false;
  const isolatedSession = session.fromPartition("easy-proto");
  const preview = new Preview(isolatedSession);
  await preview.install(join(app.getAppPath(), "dist", "ui"));
  const window = new BrowserWindow({
    title: "Easy Proto",
    width: 1180,
    height: 770,
    minWidth: 660,
    minHeight: 480,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#2c2c2c" : "#ffffff",
    webPreferences: {
      ...securePreferences,
      session: isolatedSession,
      preload: join(app.getAppPath(), "dist", "preload.cjs"),
    },
  });
  preview.protect(window.webContents);
  function scene(): DesktopState {
    const projects = recent.list();
    if (!active) return { view: "home", sceneVersion, projects };
    const { project, activity } = active;
    const snapshot = preview.scene(project, generation);
    return {
      ...snapshot,
      view: "project",
      sceneVersion,
      name: project.name,
      projects,
      artboards: snapshot.artboards.map((board) => ({
        ...board,
        agentWorking: activity.isWorking(board.id),
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

  ipcMain.handle(ipc.choose, async (event, ...args: unknown[]) => {
    allowSender(event, window);
    const [mode] = args;
    if (args.length !== 1 || (mode !== "create" && mode !== "open"))
      throw new Error("Choose Create project or Open project.");
    if (choosing || switching) return;
    choosing = true;
    try {
      const creating = mode === "create";
      const selection = await dialog.showOpenDialog(window, {
        title: creating ? "New Project" : "Open Project",
        buttonLabel: creating ? "Create Project" : "Open Project",
        defaultPath: active ? dirname(active.project.root) : app.getPath("documents"),
        message: creating
          ? "Choose an empty folder or create a new folder."
          : "Choose the folder that contains your Easy Proto project.",
        properties: creating ? ["openDirectory", "createDirectory"] : ["openDirectory"],
      });
      const [folder] = selection.filePaths;
      if (selection.canceled || !folder || window.isDestroyed()) return;
      await switchTo(() => Project.open(folder, undefined, mode), !creating);
    } catch {
      throw new Error(
        mode === "create"
          ? "Could not create the project. Choose a new or empty folder."
          : "Could not open the project. Choose a folder containing a valid Easy Proto project.",
      );
    } finally {
      choosing = false;
    }
  });

  ipcMain.handle(ipc.recent, async (event, ...args: unknown[]) => {
    allowSender(event, window);
    if (args.length !== 1 || choosing || switching || active) return;
    const entry = recent.find(id.parse(args[0]));
    try {
      await switchTo(async () => {
        if (!entry) throw new Error("Unknown project.");
        if ((await realpath(entry.folder)) !== entry.folder)
          throw new Error("The saved project folder now resolves to a different location.");
        const project = await Project.open(entry.folder, undefined, "open");
        if (project.root !== entry.folder)
          throw new Error("The saved project folder changed while opening.");
        project.authorize(entry.projectId);
        return project;
      });
    } catch {
      throw new Error(
        "Could not reopen this project. If it moved, find it with Open project in Settings.",
      );
    }
  });

  ipcMain.handle(ipc.home, async (event, ...args: unknown[]) => {
    allowSender(event, window);
    if (args.length || choosing || switching || !active) return;
    await switchTo(async () => undefined);
  });

  function activeGeneration(selectedGeneration: unknown) {
    if (!active || selectedGeneration !== generation)
      throw new ProjectError("PROJECT_SCOPE", "The project selection changed.");
    checkWritable();
    return active.project;
  }

  ipcMain.handle(ipc.rename, async (event, ...args: unknown[]) => {
    allowSender(event, window);
    const [selectedGeneration, previous, name] = z
      .tuple([z.number().int().nonnegative(), z.string().max(4096), projectName])
      .parse(args);
    const project = activeGeneration(selectedGeneration);
    await project.rename(previous, name);
    await remember(project);
    changed();
  });

  ipcMain.handle(ipc.scene, (event) => {
    allowSender(event, window);
    return scene();
  });
  ipcMain.handle(ipc.arrange, async (event, selectedGeneration: unknown, input: unknown) => {
    allowSender(event, window);
    const command = commandSchema.parse(input);
    if (
      command.operation !== "update_artboard" ||
      !desktopArtboardPatch.safeParse(command.arguments.patch).success
    ) {
      throw new Error("This control can only change artboard name, position or size.");
    }
    try {
      const project = activeGeneration(selectedGeneration);
      const commit = await project.execute(command);
      changed();
      return commit;
    } catch (error) {
      if (error instanceof ProjectError) throw new Error(error.message);
      throw new Error("The artboard layout could not be saved.");
    }
  });

  const token = process.env.EASY_PROTO_TOKEN;
  if (token) {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token))
      throw new Error("Set EASY_PROTO_TOKEN to a random URL-safe token of at least 43 characters.");
    const port = z.coerce
      .number()
      .int()
      .min(0)
      .max(65535)
      .parse(process.env.EASY_PROTO_PORT ?? "38645");
    const endpoint = await listen(() => active, preview, changed, checkWritable, port, token);
    console.log("Easy Proto MCP listening at", endpoint.url);
    app.once("will-quit", endpoint.stop);
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]),
  );
  window.on("closed", () => active?.retire());
  window.once("ready-to-show", () => window.show());
  await window.loadURL(chromeUrl);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () =>
    BrowserWindow.getAllWindows()
      .find((window) => window.isVisible())
      ?.focus(),
  );
  app.on("window-all-closed", () => app.quit());
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown startup error.";
      console.error("Easy Proto startup failed:", message);
      if (!testProfile) dialog.showErrorBox("Easy Proto could not start", message);
      app.exit(1);
    });
}
