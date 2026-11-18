import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  Menu,
  nativeTheme,
  app,
  BrowserWindow,
  clipboard,
  safeStorage,
  shell,
  dialog,
  ipcMain,
  session,
  type IpcMainInvokeEvent,
} from "electron";
import { z } from "zod";
import { agentAction, agentId } from "../shared/agents";
import { chatPromptLimit } from "../shared/chat";
import {
  artboardIds,
  commandSchema,
  desktopArtboardPatch,
  id,
  ipc,
  projectName,
  revision,
  type DesktopState,
} from "../shared/model";
import { ArtboardActivity } from "./activity";
import { ProjectChat, type ChatMemory } from "./chat";
import { AgentProfiles, demoAgentId, keyAgentId } from "./agents";
import { configuredCodex, installedCodex } from "./codex";
import { colorToHex, tokenByteLimit } from "../shared/token-types";
import desktopTokens from "../renderer/design.tokens.json";
import { listen, type ActiveProject } from "./mcp";
import { chromeUrl, Preview, securePreferences } from "./preview";
import { Project, ProjectError, readRegular } from "./project";
import { RecentProjects } from "./recent-projects";
import { parseTokenDocument } from "./tokens";

const projectOption = process.argv
  .find((arg) => arg.startsWith("--project="))
  ?.slice("--project=".length);
const launchDirectory = process.env.INIT_CWD ?? process.cwd();
const testProfile = process.env.EASY_PROTO_PROFILE;
if (testProfile) app.setPath("userData", resolve(launchDirectory, testProfile));

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
  const profileDir = app.getPath("userData");
  const agentsPath = join(profileDir, "agent-profiles.bin");
  const legacyPath = join(profileDir, "chatgpt-account.bin");
  const codex = await installedCodex();
  async function decrypt(path: string) {
    try {
      return safeStorage.decryptString(await readFile(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
  const agents = await AgentProfiles.load(
    {
      read: () => decrypt(agentsPath),
      legacy: () => decrypt(legacyPath),
      finishMigration: () => rm(legacyPath, { force: true }),
      async write(record) {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error("Unlock your macOS keychain to save an agent.");
        const staging = agentsPath + "." + randomUUID();
        try {
          await writeFile(staging, safeStorage.encryptString(record), {
            flag: "wx",
            mode: 0o600,
            flush: true,
          });
          await rename(staging, agentsPath);
        } catch {
          throw new Error("Could not save the agent profiles.");
        } finally {
          await rm(staging, { force: true }).catch(() => undefined);
        }
      },
    },
    {
      codex,
      demo: process.env.EASY_PROTO_CHAT_DEMO === "1",
      experimental: configuredCodex(),
      open: async (url) => {
        await shell.openExternal(url).catch(() => {
          throw new Error("Easy Proto could not open your browser.");
        });
      },
    },
  ).catch(() => undefined);
  const agentState = () =>
    agents?.status ?? {
      profiles: [],
      codexInstalled: false,
      claudeInstalled: false,
      message: "Agent profiles are unavailable. Unlock your macOS keychain and reopen Easy Proto.",
    };
  const conversations = new Map<string, ChatMemory>();
  let active: (ActiveProject & { chat: ProjectChat }) | undefined;
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
  function activate(project: Project): ActiveProject & { chat: ProjectChat } {
    const lifetime = new AbortController();
    const activationId = randomUUID();
    const key = JSON.stringify([project.root, project.snapshot.manifest.projectId]);
    const memory: ChatMemory = conversations.get(key) ?? { history: new Map() };
    if (
      memory.agentId &&
      !agents?.status.profiles.some(
        ({ id, state }) => id === memory.agentId && state === "connected",
      )
    )
      delete memory.agentId;
    conversations.delete(key);
    conversations.set(key, memory);
    if (conversations.size > 32) conversations.delete(conversations.keys().next().value!);
    return {
      project,
      activationId,
      signal: lifetime.signal,
      activity: new ArtboardActivity(lifetime.signal, changed),
      chat: new ProjectChat(
        project,
        lifetime.signal,
        (state) => {
          if (active?.activationId !== activationId || window.isDestroyed()) return;
          try {
            window.webContents.send(ipc.chatChanged, { generation, ...state });
          } catch {
            // A reloaded renderer reads the current chat state when it mounts.
          }
        },
        () => {
          if (active?.activationId === activationId) changed();
        },
        memory,
        (id) => {
          if (!agents) throw new Error("Agent profiles are unavailable.");
          return agents.provider(id);
        },
        agents?.defaultAgent,
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
  let choosing = false;
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
      tokenDigest: project.snapshot.tokens?.stamp.documentDigest,
      canUndo: project.canUndo,
      canRedo: project.canRedo,
      projects,
      artboards: snapshot.artboards.map((board) => ({
        ...board,
        pageId: board.pageId ?? pageLayout.defaultPageId,
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
    active?.chat.stopUnresolved();
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
    allowSender(event, window);
    if (args.length !== 1 || choosing || switching || active) return;
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

  ipcMain.handle(ipc.saveCopy, async (event, ...args: unknown[]) => {
    allowSender(event, window);
    const [selectedGeneration] = z.tuple([revision]).parse(args);
    if (choosing || switching) return false;
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
  ipcMain.handle(ipc.agents, async (event, raw: unknown) => {
    allowSender(event, window);
    const action = agentAction.safeParse(raw);
    if (!action.success) throw new Error("Check the agent name and connection details.");
    if (action.data.action === "status") return agentState();
    if (!agents) throw new Error("Agent profiles are unavailable.");
    if (active || switching) throw new Error("Manage agent connections from Home.");
    try {
      return await agents.action(action.data);
    } finally {
      if (!window.isDestroyed()) window.webContents.send(ipc.agentsChanged, agentState());
    }
  });
  ipcMain.handle(ipc.chatSelect, (event, generation: unknown, input: unknown) => {
    allowSender(event, window);
    activeGeneration(generation);
    return active!.chat.select(
      z.union([agentId, z.literal(demoAgentId), z.literal(keyAgentId)]).parse(input),
    );
  });
  ipcMain.handle(ipc.chat, (event, generation: unknown) => {
    allowSender(event, window);
    activeGeneration(generation);
    return active!.chat.state;
  });
  ipcMain.handle(ipc.chatStart, (event, generation: unknown, input: unknown) => {
    allowSender(event, window);
    activeGeneration(generation);
    return active!.chat.start(
      z
        .strictObject({
          pageId: id.optional(),
          expectedRevision: revision,
          prompt: z.string().trim().min(1).max(chatPromptLimit),
        })
        .parse(input),
    );
  });
  ipcMain.handle(
    ipc.chatDecide,
    (event, generation: unknown, turnId: unknown, decision: unknown) => {
      allowSender(event, window);
      activeGeneration(generation);
      return active!.chat.decide(
        id.parse(turnId),
        z.enum(["apply", "discard", "stop", "allow_source"]).parse(decision),
      );
    },
  );
  ipcMain.handle(ipc.tokens, (event, generation: unknown) => {
    allowSender(event, window);
    return activeGeneration(generation).tokenView;
  });
  ipcMain.handle(ipc.copyTokenCss, (event, generation: unknown, path: unknown) => {
    allowSender(event, window);
    const project = activeGeneration(generation);
    const name = z.string().max(400).parse(path);
    const row = project.tokenView.rows.find(({ path }) => path === name);
    if (!row) throw new Error("That token is no longer in the project.");
    clipboard.writeText(`var(${row.cssName})`);
  });
  ipcMain.handle(ipc.importTokens, async (event, generation: unknown) => {
    allowSender(event, window);
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
    allowSender(event, window);
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
    allowSender(event, window);
    const project = activeGeneration(generation);
    project.copyArtboards(artboardIds.parse(ids), id.parse(clipboardId));
  });
  ipcMain.handle(ipc.arrange, async (event, selectedGeneration: unknown, input: unknown) => {
    allowSender(event, window);
    const command = commandSchema.parse(input);
    if (
      command.operation === "create_artboard" ||
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
      if (active?.project === project)
        active.activity.pruneLeases((id) => project.snapshot.sources.has(id));
      changed();
      return commit;
    } catch (error) {
      if (error instanceof ProjectError) throw new Error(error.message);
      throw new Error("The project change could not be saved.");
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
  window.on("closed", () => {
    active?.retire();
    agents?.cancel();
  });
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
