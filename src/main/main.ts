import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { Menu, app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { commandSchema, geometryPatch, ipc, type Scene } from "../shared/model";
import { listen, type ActiveProject } from "./mcp";
import { chromeUrl, Preview, securePreferences } from "./preview";
import { Project, ProjectError } from "./project";

const projectOption = process.argv.find((arg) => arg.startsWith("--project="))?.slice("--project=".length);
const testProfile = process.env.EASY_PROTO_PROFILE;
if (testProfile) app.setPath("userData", resolve(testProfile));

function allowSender(event: IpcMainInvokeEvent, window: BrowserWindow) {
  if (event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== chromeUrl) throw new Error("Only the application window can use this command.");
}

async function start() {
  const folder = resolve(projectOption || join(app.getPath("userData"), "Projects", "Untitled"));
  let project: Project;
  try {
    project = await Project.open(folder);
  } catch {
    throw new Error("Easy Proto could not open this folder. Choose a valid project or an empty folder with --project=PATH.");
  }
  let lifetime = new AbortController();
  let active: ActiveProject = { project, activationId: randomUUID(), signal: lifetime.signal };
  let generation = 0;
  let choosing = false;
  let switching = false;
  const isolatedSession = session.fromPartition("easy-proto");
  const preview = new Preview(isolatedSession);
  await preview.install(join(app.getAppPath(), "dist", "ui"));
  const window = new BrowserWindow({
    title: "Easy Proto", width: 1180, height: 770, minWidth: 660, minHeight: 480,
    show: false, backgroundColor: "#fafafa",
    webPreferences: {
      ...securePreferences, session: isolatedSession, preload: join(app.getAppPath(), "dist", "preload.cjs"),
    },
  });
  preview.protect(window.webContents);
  function scene(): Scene {
    return { ...preview.scene(active.project, generation), folderName: basename(active.project.root) };
  }
  function changed() {
    if (window.isDestroyed()) return;
    const next = scene();
    try {
      window.webContents.send(ipc.changed, next);
    } catch {
      // A renderer that is closing can reload the authoritative scene on next launch.
    }
  }

  function checkWritable() {
    if (switching) throw new ProjectError("PROJECT_SWITCHING", "The project is switching. Call get_context and try again.");
  }

  ipcMain.handle(ipc.choose, async (event, ...args: unknown[]) => {
    allowSender(event, window);
    const [mode] = args;
    if (args.length !== 1 || (mode !== "create" && mode !== "open")) throw new Error("Choose New Project or Open Project.");
    if (choosing) return;
    choosing = true;
    try {
      const creating = mode === "create";
      const selection = await dialog.showOpenDialog(window, {
        title: creating ? "New Project" : "Open Project",
        buttonLabel: creating ? "Create Project" : "Open Project",
        defaultPath: dirname(active.project.root),
        message: creating ? "Choose an empty folder or create a new folder." : "Choose the folder that contains your Easy Proto project.",
        properties: creating ? ["openDirectory", "createDirectory"] : ["openDirectory"],
      });
      const [folder] = selection.filePaths;
      if (selection.canceled || !folder || window.isDestroyed()) return;

      switching = true;
      await active.project.whenIdle();
      if (window.isDestroyed()) return;
      const next = await Project.open(folder, undefined, mode);
      if (window.isDestroyed()) return;

      const previousLifetime = lifetime;
      lifetime = new AbortController();
      active = { project: next, activationId: randomUUID(), signal: lifetime.signal };
      generation++;
      previousLifetime.abort();
      changed();
    } catch {
      throw new Error(mode === "create"
        ? "Could not create the project. Choose a new or empty folder."
        : "Could not open the project. Choose a folder containing a valid Easy Proto project.");
    } finally {
      switching = false;
      choosing = false;
    }
  });

  ipcMain.handle(ipc.scene, (event) => {
    allowSender(event, window);
    return scene();
  });
  ipcMain.handle(ipc.arrange, async (event, selectedGeneration: unknown, input: unknown) => {
    allowSender(event, window);
    const command = commandSchema.parse(input);
    if (command.operation !== "update_artboard" || !geometryPatch.safeParse(command.arguments.patch).success) {
      throw new Error("This control can only change artboard position and size.");
    }
    try {
      if (selectedGeneration !== generation) throw new ProjectError("PROJECT_SCOPE", "The project selection changed.");
      checkWritable();
      const commit = await active.project.execute(command);
      changed();
      return commit;
    } catch (error) {
      if (error instanceof ProjectError) throw new Error(error.message);
      throw new Error("The artboard layout could not be saved.");
    }
  });

  const token = process.env.EASY_PROTO_TOKEN;
  if (token) {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error("Set EASY_PROTO_TOKEN to a random URL-safe token of at least 43 characters.");
    const port = z.coerce.number().int().min(0).max(65535).parse(process.env.EASY_PROTO_PORT ?? "38645");
    const endpoint = await listen(() => active, preview, changed, checkWritable, port, token);
    console.log("Easy Proto MCP listening at", endpoint.url);
    app.once("will-quit", endpoint.stop);
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { label: "Edit", submenu: [{ role: "copy" }, { role: "selectAll" }] },
    { role: "windowMenu" },
  ]));
  window.on("closed", () => lifetime.abort());
  window.once("ready-to-show", () => window.show());
  await window.loadURL(chromeUrl);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => BrowserWindow.getAllWindows().find((window) => window.isVisible())?.focus());
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(start).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown startup error.";
    console.error("Easy Proto startup failed:", message);
    if (!testProfile) dialog.showErrorBox("Easy Proto could not start", message);
    app.exit(1);
  });
}
