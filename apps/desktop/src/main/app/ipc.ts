import { randomUUID } from "node:crypto";
import { realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { z } from "zod";
import {
  artboardIds,
  commandSchema,
  desktopArtboardPatch,
  id,
  ipc,
  projectName,
  revision,
  type DesktopState,
} from "../../shared/model";
import { tokenByteLimit } from "../../shared/token-types";
import { Project, ProjectError, readRegular } from "../document/project";
import type { RecentProjects } from "../document/recent-projects";
import type { ActiveProject } from "../mcp/server";
import { chromeUrl, type Preview } from "../previews/preview";
import { registerPublishingIpc } from "../publishing/ipc";
import type { WebPreviewSettings } from "../publishing/web-preview";

type ProjectState = {
  readonly active: ActiveProject | undefined;
  readonly generation: number;
  readonly switching: boolean;
};

export function registerIpc({
  window,
  recent,
  state,
  switchTo,
  checkWritable,
  remember,
  scene,
  changed,
  preview,
  webSettings,
}: {
  window: BrowserWindow;
  recent: RecentProjects;
  state: ProjectState;
  switchTo(load: () => Promise<Project | undefined>, findMoved?: boolean): Promise<void>;
  checkWritable(): void;
  remember(project: Project): Promise<void>;
  scene(): DesktopState;
  changed(): void;
  preview: Preview;
  webSettings: WebPreviewSettings | undefined;
}) {
  let choosing = false;

  function allowSender(event: IpcMainInvokeEvent) {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== chromeUrl
    )
      throw new Error("Only the application window can use this command.");
  }

  ipcMain.handle(ipc.choose, async (event, ...args: unknown[]) => {
    allowSender(event);
    const [mode] = args;
    if (args.length !== 1 || (mode !== "create" && mode !== "open"))
      throw new Error("Choose Create project or Open project.");
    if (choosing || state.switching) return;
    choosing = true;
    try {
      const creating = mode === "create";
      const selection = await dialog.showOpenDialog(window, {
        title: creating ? "New Project" : "Open Project",
        buttonLabel: creating ? "Create Project" : "Open Project",
        defaultPath: state.active ? dirname(state.active.project.root) : app.getPath("documents"),
        message: creating
          ? "Choose an empty folder or create a new folder."
          : "Choose an Easy Proto project folder or .easyproto file.",
        properties: creating
          ? ["openDirectory", "createDirectory"]
          : process.platform === "darwin"
            ? ["openDirectory", "openFile"]
            : ["openDirectory"],
      });
      const [folder] = selection.filePaths;
      if (selection.canceled || !folder || window.isDestroyed()) return;
      await switchTo(() => Project.open(folder, undefined, mode), !creating);
    } catch {
      throw new Error(
        mode === "create"
          ? "Could not create the project. Choose a new or empty folder."
          : "Could not open the project. Choose a valid project folder or .easyproto file.",
      );
    } finally {
      choosing = false;
    }
  });

  ipcMain.handle(ipc.recent, async (event, ...args: unknown[]) => {
    allowSender(event);
    if (args.length !== 1 || choosing || state.switching || state.active) return;
    const entry = recent.find(id.parse(args[0]));
    try {
      await switchTo(async () => {
        if (!entry) throw new Error("Unknown project.");
        if ((await realpath(entry.folder)) !== entry.folder)
          throw new Error("The saved project now resolves to a different location.");
        const project = await Project.open(entry.folder, undefined, "open");
        if (project.root !== entry.folder)
          throw new Error("The saved project changed while opening.");
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
    allowSender(event);
    if (args.length || choosing || state.switching || !state.active) return;
    await switchTo(async () => undefined);
  });

  function activeGeneration(selectedGeneration: unknown) {
    if (!state.active || selectedGeneration !== state.generation)
      throw new ProjectError("PROJECT_SCOPE", "The project selection changed.");
    checkWritable();
    return state.active.project;
  }

  ipcMain.handle(ipc.saveCopy, async (event, ...args: unknown[]) => {
    allowSender(event);
    const [selectedGeneration] = z.tuple([revision]).parse(args);
    if (choosing || state.switching) return false;
    const project = activeGeneration(selectedGeneration);
    choosing = true;
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: "Save a Copy",
        buttonLabel: "Save Copy",
        defaultPath: join(
          dirname(project.root),
          `${basename(project.root, ".easyproto")} copy.easyproto`,
        ),
        showsTagField: false,
        properties: ["createDirectory"],
      });
      if (canceled || !filePath || window.isDestroyed()) return false;
      const extension = extname(filePath);
      if (extension && extension !== ".easyproto")
        throw new ProjectError("COPY_DESTINATION", "Use a filename ending in .easyproto.");
      await project.saveCopy(extension ? filePath : `${filePath}.easyproto`, () => {
        if (window.isDestroyed())
          throw new ProjectError("PROJECT_SCOPE", "The project selection changed.");
        activeGeneration(selectedGeneration);
      });
      return true;
    } catch (error) {
      if (error instanceof ProjectError) throw error;
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(
          "A file already exists at that location. Choose a different name or folder.",
        );
      throw new Error(
        "The project copy could not be saved. Choose another location and try again.",
      );
    } finally {
      choosing = false;
    }
  });

  ipcMain.handle(ipc.rename, async (event, ...args: unknown[]) => {
    allowSender(event);
    const [selectedGeneration, previous, name] = z
      .tuple([z.number().int().nonnegative(), z.string().max(4096), projectName])
      .parse(args);
    const project = activeGeneration(selectedGeneration);
    await project.rename(previous, name);
    await remember(project);
    changed();
  });

  ipcMain.on(ipc.visiblePage, (event, selectedGeneration: unknown, pageId: unknown) => {
    allowSender(event);
    if (
      state.active &&
      selectedGeneration === state.generation &&
      typeof pageId === "string" &&
      state.active.project.pageLayout.pages.some((page) => page.id === pageId)
    )
      state.active.activePageId = pageId;
  });
  ipcMain.handle(ipc.scene, (event) => {
    allowSender(event);
    return scene();
  });
  registerPublishingIpc({ allowSender, activeGeneration, state, preview, webSettings });
  ipcMain.handle(ipc.tokens, (event, generation: unknown) => {
    allowSender(event);
    return activeGeneration(generation).tokenView;
  });
  ipcMain.handle(ipc.copyTokenCss, (event, generation: unknown, path: unknown) => {
    allowSender(event);
    const project = activeGeneration(generation);
    const name = z.string().max(400).parse(path);
    const row = project.tokenView.rows.find(({ path }) => path === name);
    if (!row) throw new Error("That token is no longer in the project.");
    clipboard.writeText(`var(${row.cssName})`);
  });
  ipcMain.handle(ipc.importTokens, async (event, generation: unknown) => {
    allowSender(event);
    activeGeneration(generation);
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: "Import design tokens",
      properties: ["openFile"],
      filters: [{ name: "Design tokens", extensions: ["json", "tokens"] }],
    });
    if (canceled || !filePaths[0]) return null;
    activeGeneration(generation);
    let document: string;
    try {
      document = new TextDecoder("utf-8", { fatal: true }).decode(
        await readRegular(filePaths[0], tokenByteLimit),
      );
    } catch {
      throw new Error("Choose a regular UTF-8 JSON file of at most 128 KiB.");
    }
    activeGeneration(generation);
    return document;
  });
  ipcMain.handle(ipc.exportTokens, async (event, generation: unknown, input: unknown) => {
    allowSender(event);
    const format = z.enum(["json", "css"]).parse(input);
    const view = activeGeneration(generation).tokenView;
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: "Export committed tokens",
      defaultPath: format === "json" ? "design.tokens.json" : "tokens.css",
      filters: [{ name: format === "json" ? "Design tokens" : "Stylesheet", extensions: [format] }],
    });
    if (canceled || !filePath) return;
    activeGeneration(generation);
    // Generated project files are published only through the command service.
    const destination = await realpath(dirname(filePath));
    if (
      destination.toLowerCase().split(/[\\/]/).includes(".easy-proto") ||
      basename(filePath).toLowerCase() === "project.json"
    )
      throw new Error("Choose an export location outside the managed project files.");
    activeGeneration(generation);
    const staging = join(destination, `.easy-proto-export-${randomUUID()}`);
    try {
      await writeFile(staging, format === "json" ? view.document : view.css, {
        flag: "wx",
        flush: true,
      });
      activeGeneration(generation);
      await rename(staging, join(destination, basename(filePath)));
    } catch {
      throw new Error("The token export could not be saved.");
    } finally {
      await rm(staging, { force: true }).catch(() => undefined);
    }
  });
  ipcMain.handle(ipc.copy, (event, generation: unknown, ids: unknown, clipboardId: unknown) => {
    allowSender(event);
    const project = activeGeneration(generation);
    project.copyArtboards(artboardIds.parse(ids), id.parse(clipboardId));
  });
  ipcMain.handle(ipc.arrange, async (event, selectedGeneration: unknown, input: unknown) => {
    allowSender(event);
    const command = commandSchema.parse(input);
    if (
      command.operation === "create_artboard" ||
      command.operation === "update_artboards" ||
      (command.operation === "update_artboard" &&
        !desktopArtboardPatch.safeParse(command.arguments.patch).success)
    ) {
      throw new Error(
        "This control can only change artboard name, position or size, or run a canvas editing command.",
      );
    }
    try {
      const project = activeGeneration(selectedGeneration);
      const commit = await project.execute(command);
      if (state.active?.project === project)
        state.active.activity.pruneLeases((id) => project.snapshot.sources.has(id));
      changed();
      return commit;
    } catch (error) {
      if (error instanceof ProjectError) throw new Error(error.message);
      throw new Error("The project change could not be saved.");
    }
  });
}
