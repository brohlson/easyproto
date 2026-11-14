import { basename, join, resolve } from "node:path";
import { Menu, app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { commandSchema, ipc, type Scene } from "../shared/model";
import { listen } from "./mcp";
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
  const isolatedSession = session.fromPartition("easy-proto");
  const preview = new Preview(isolatedSession);
  await preview.install(join(app.getAppPath(), "dist", "ui"));
  const window = new BrowserWindow({
    title: "Easy Proto", width: 1180, height: 770, minWidth: 660, minHeight: 480,
    show: false, backgroundColor: "#f6f5f0",
    webPreferences: {
      ...securePreferences, session: isolatedSession, preload: join(app.getAppPath(), "dist", "preload.cjs"),
    },
  });
  preview.protect(window.webContents);
  function scene(): Scene {
    return { ...preview.scene(project), folderName: basename(project.root) };
  }
  function changed() {
    if (window.isDestroyed()) return;
    try {
      window.webContents.send(ipc.changed, scene());
    } catch {
      // A renderer that is closing can reload the authoritative scene on next launch.
    }
  }

  ipcMain.handle(ipc.scene, (event) => {
    allowSender(event, window);
    return scene();
  });
  ipcMain.handle(ipc.move, async (event, input: unknown) => {
    allowSender(event, window);
    const command = commandSchema.parse(input);
    if (command.operation !== "update_artboard" || !Object.keys(command.arguments.patch).every((key) => key === "x" || key === "y")) {
      throw new Error("This control can only move an artboard.");
    }
    try {
      const commit = await project.execute(command);
      changed();
      return commit;
    } catch (error) {
      if (error instanceof ProjectError) throw new Error(error.message);
      throw new Error("The artboard could not be moved.");
    }
  });

  const token = process.env.EASY_PROTO_TOKEN;
  if (token) {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error("Set EASY_PROTO_TOKEN to a random URL-safe token of at least 43 characters.");
    const port = z.coerce.number().int().min(0).max(65535).parse(process.env.EASY_PROTO_PORT ?? "38645");
    const endpoint = await listen(project, preview, changed, port, token);
    console.log("Easy Proto MCP listening at", endpoint.url);
    app.once("will-quit", endpoint.stop);
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { label: "Edit", submenu: [{ role: "copy" }, { role: "selectAll" }] },
    { role: "windowMenu" },
  ]));
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
