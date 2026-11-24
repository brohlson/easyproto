import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rmdir } from "node:fs/promises";
import { basename, extname, join, sep } from "node:path";
import type { z } from "zod";
import {
  boardInput,
  commandSchema,
  coordinateLimit,
  revision,
  type Artboard,
  type Commit,
  type Page,
  type PageLayout,
  type Source,
} from "../../shared/model";
import {
  loadFolderSnapshot,
  managed,
  missing,
  prepareBytes,
  projectLabel,
  publishFolderSnapshot,
  readAssets,
  readFolderName,
  renameFolderProject,
  requireDirectory,
  validateDatabaseAssets,
  type CommitPhase,
} from "./folder-storage";
import { canonical, digest, validateSnapshot, type Asset, type Snapshot } from "./snapshot";
import {
  readSqliteProject,
  renameSqliteProject,
  saveSqliteProject,
  writeSqliteProjectCopy,
  type SqliteIdentity,
} from "./sqlite-project";
import { compileTokens, TokenError, type TokenBundle } from "./tokens";

export { readRegular } from "./folder-storage";
export { digest, type Asset, type Snapshot } from "./snapshot";

export class ProjectError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly currentRevision?: number,
  ) {
    super(message);
  }
}

type BoardInput = z.infer<typeof boardInput>;
type ArtboardState = { board: Artboard; source: Source };
type HistoryChange = { index: number } & (
  | { before?: ArtboardState; after: ArtboardState }
  | { before: ArtboardState; after?: never }
);
type HistoryEntry =
  | HistoryChange[]
  | { page: { before?: Page; after: Page } }
  | {
      deletedPage: {
        page: Page;
        index: number;
        previousDefault: string;
        nextDefault: string;
        artboards: HistoryChange[];
      };
    }
  | { tokens: { before?: TokenBundle; after: TokenBundle } };
type HistoryItem = { commandId: string; entry: HistoryEntry };
const historyLimit = 50;

function metadata(artboardId: string, atRevision: number, input: BoardInput, pageId?: string) {
  const { html, css, ...bounds } = input;
  const artboard: Artboard = {
    ...bounds,
    id: artboardId,
    ...(pageId && { pageId }),
    sourceRevision: atRevision,
    sourceDigest: digest(canonical({ html, css })),
    htmlRef: `${artboardId}.html`,
    cssRef: `${artboardId}.css`,
  };
  return { artboard, source: { html, css } };
}

export function translation(bounds: Pick<Artboard, "x" | "y">[], dx: number, dy: number) {
  const clamp = (delta: number, axis: "x" | "y") => {
    const values = bounds.map((board) => board[axis]);
    return Math.max(
      -coordinateLimit - Math.min(...values),
      Math.min(delta, coordinateLimit - Math.max(...values)),
    );
  };
  return { x: clamp(dx, "x"), y: clamp(dy, "y") };
}

function translatedPosition(board: Artboard, offset: { x: number; y: number }) {
  // Adding a clamped delta can still round past the coordinate limit.
  const clamp = (value: number) => Math.max(-coordinateLimit, Math.min(value, coordinateLimit));
  return { x: clamp(board.x + offset.x), y: clamp(board.y + offset.y) };
}

function copyOffset(originals: Artboard[], boards: Artboard[]) {
  const occupied = new Set(boards.map(({ x, y }) => `${x},${y}`));
  const attempts = occupied.size * originals.length + 1;
  const free = ({ x, y }: { x: number; y: number }) =>
    (x || y) &&
    originals.every((board) => {
      const position = translatedPosition(board, { x, y });
      return !occupied.has(`${position.x},${position.y}`);
    });
  for (let step = 40; step <= 40 * attempts; step += 40) {
    const forward = translation(originals, step, step);
    const backward = translation(originals, -step, -step);
    const offset = {
      x: forward.x === step ? forward.x : backward.x,
      y: forward.y === step ? forward.y : backward.y,
    };
    if (free(offset)) return offset;
  }
  // A group at the canvas limits may only have room for a smaller shift.
  for (const [dx, dy] of [
    [40, 40],
    [-40, -40],
    [40, 0],
    [-40, 0],
    [0, 40],
    [0, -40],
  ]) {
    const room = translation(originals, dx, dy);
    if (!room.x && !room.y) continue;
    for (let step = attempts; step > 0; step--) {
      const offset = { x: room.x * (step / attempts), y: room.y * (step / attempts) };
      if (free(offset)) return offset;
    }
  }
  throw new ProjectError(
    "PROJECT_CAPACITY",
    "Make room on the canvas before duplicating this selection.",
  );
}

function copyInput(original: ArtboardState, offset: { x: number; y: number }): BoardInput {
  const { name, width, height } = original.board;
  const suffix = " copy";
  const prefix = name
    .slice(0, 100 - suffix.length)
    .replace(/[\uD800-\uDBFF]$/, "")
    .trimEnd();
  return {
    name: prefix + suffix,
    width,
    height,
    ...translatedPosition(original.board, offset),
    ...original.source,
  };
}

function readBoards({ manifest, sources }: Snapshot, artboardIds: string[]) {
  const ids = new Set(artboardIds);
  const matches = manifest.artboards.flatMap((board, index) =>
    ids.has(board.id) ? [{ index, before: { board, source: sources.get(board.id)! } }] : [],
  );
  if (matches.length !== ids.size)
    throw new ProjectError("ARTBOARD_NOT_FOUND", "An artboard in the selection no longer exists.");
  return matches;
}

function applyHistory(
  entry: HistoryChange[],
  undo: boolean,
  boards: Artboard[],
  sources: Map<string, Source>,
  atRevision: number,
  defaultPageId?: string,
) {
  return entry.map((change) => {
    const id = (change.after ?? change.before).board.id;
    const index = boards.findIndex((board) => board.id === id);
    const current = boards[index];
    const target = undo ? change.before : change.after;
    if (!target) {
      if (!current) throw new Error("The artboard to remove is missing.");
      boards.splice(index, 1);
      sources.delete(id);
      return current;
    }
    const sourceRevision =
      current?.sourceDigest === target.board.sourceDigest ? current.sourceRevision : atRevision;
    const pageId = target.board.pageId ?? defaultPageId;
    const board = { ...target.board, sourceRevision, ...(pageId && { pageId }) };
    if (current) boards[index] = board;
    else boards.splice(change.index, 0, board);
    sources.set(id, target.source);
    return board;
  });
}

function defaultPageLayout(projectId: string): PageLayout {
  const hash = digest(`easy-proto:default-page:${projectId}`);
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return { defaultPageId: id, pages: [{ id, name: "Page 1" }] };
}

function starter(): Snapshot {
  const welcome = metadata(randomUUID(), 0, {
    name: "Field notes",
    x: 0,
    y: 0,
    width: 540,
    height: 360,
    html: '<main><p class="series">THE FIELD NOTES SERIES</p><h1>Make room<br>for ideas.</h1><p>A starting point for your next mockup.</p></main>',
    css: "body{margin:0;background:#f4efe5;color:#173b33;font:16px system-ui}main{padding:40px 46px}h1{font:normal 70px/.92 Georgia,serif;letter-spacing:-.07em;margin:30px 0}.series{font-size:10px;letter-spacing:.22em;font-weight:700}",
  });
  return {
    manifest: {
      schemaVersion: 1,
      projectId: randomUUID(),
      revision: 0,
      artboards: [welcome.artboard],
      commands: [],
    },
    sources: new Map([[welcome.artboard.id, welcome.source]]),
  };
}

export class Project {
  #tail = Promise.resolve();
  #snapshot: Snapshot;
  #undo: HistoryItem[] = [];
  #redo: HistoryItem[] = [];
  #clipboard?: { id: string; originals: ArtboardState[] };
  readonly assetDigest: string;

  private constructor(
    readonly root: string,
    snapshot: Snapshot,
    readonly assets: ReadonlyMap<string, Asset>,
    private displayName: string,
    private readonly onPhase?: (phase: CommitPhase) => void,
    private readonly sqlite?: SqliteIdentity,
  ) {
    this.#snapshot = snapshot;
    this.assetDigest = digest(
      canonical([...assets].map(([path, asset]) => [path, digest(asset.bytes)])),
    );
  }

  static async open(
    path: string,
    onPhase?: (phase: CommitPhase) => void,
    mode: "open" | "create" | "either" = "either",
  ) {
    if (extname(path) === ".easyproto" && mode !== "create") {
      const selected = await lstat(path, { bigint: true });
      if (!selected.isDirectory()) {
        if (!selected.isFile()) throw new Error("Choose a regular Easy Proto project file.");
        const root = await realpath(path);
        const stored = readSqliteProject(root, selected);
        validateDatabaseAssets(stored.assets);
        const snapshot = await validateSnapshot(
          stored.manifest,
          (board) => stored.sources.get(board.id),
          () => stored.tokens,
        );
        return new Project(root, snapshot, stored.assets, stored.name, onPhase, stored.identity);
      }
    }
    if (mode === "either") await mkdir(path, { recursive: true });
    const root = await realpath(path);
    try {
      await lstat(join(root, "project.json"));
    } catch (error) {
      if (!missing(error) || mode === "open") throw error;
      const entries = await readdir(root);
      if (mode === "create" && entries.some((entry) => entry !== ".DS_Store")) {
        throw new Error("Choose an empty folder for the new project.");
      }
      const unrelated = entries.filter(
        (entry) =>
          !["assets", managed, ".DS_Store"].includes(entry) &&
          !/^\.project-[0-9a-f-]{36}\.tmp$/.test(entry),
      );
      if (unrelated.length)
        throw new Error("Choose an existing project or an empty project folder.");
      const assets = await readAssets(root);
      const hasManagedFolder = entries.includes(managed);
      if (hasManagedFolder) {
        await requireDirectory(join(root, managed));
        if ((await readdir(join(root, managed))).length > 0) {
          throw new Error("The project pointer is missing but revision data remains.");
        }
      } else {
        await mkdir(join(root, managed));
      }
      const snapshot = starter();
      try {
        await publishFolderSnapshot(root, snapshot);
      } catch (error) {
        if (!hasManagedFolder) await rmdir(join(root, managed)).catch(() => undefined);
        throw error;
      }
      return new Project(root, snapshot, assets, basename(root), onPhase);
    }
    if (mode === "create") throw new Error("This folder already contains a project.");
    return new Project(
      root,
      await loadFolderSnapshot(root),
      await readAssets(root),
      await readFolderName(root),
      onPhase,
    );
  }

  static async importFolder(path: string, destination: string) {
    await requireDirectory(await realpath(path));
    const source = await Project.open(path, undefined, "open");
    return source.saveCopy(destination);
  }

  async saveCopy(destination: string, checkActive?: () => void) {
    const committed = await this.#enqueue(() => {
      checkActive?.();
      return { name: this.name, snapshot: this.#snapshot, assets: this.assets };
    });
    const assetsRoot = join(this.root, "assets").toLowerCase();
    return writeSqliteProjectCopy(destination, committed, (parent) => {
      checkActive?.();
      const directory = parent.toLowerCase();
      if (
        directory.split(sep).includes(managed) ||
        (!this.sqlite && (directory === assetsRoot || directory.startsWith(assetsRoot + sep)))
      )
        throw new ProjectError("COPY_DESTINATION", "Choose a location outside project data.");
    });
  }

  get snapshot() {
    return this.#snapshot;
  }

  get name() {
    return this.displayName;
  }

  get pageLayout() {
    const { manifest } = this.#snapshot;
    return manifest.pageLayout ?? defaultPageLayout(manifest.projectId);
  }

  get tokenView() {
    const { tokens, manifest } = this.#snapshot;
    return {
      revision: manifest.revision,
      ...(tokens ? { stamp: tokens.stamp } : {}),
      document: tokens?.document ?? "{}\n",
      css: tokens?.css ?? "",
      rows: tokens?.rows ?? [],
    };
  }

  get canUndo() {
    return this.#undo.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  copyArtboards(artboardIds: string[], clipboardId: string) {
    this.#clipboard = {
      id: clipboardId,
      originals: readBoards(this.#snapshot, artboardIds).map(({ before }) => before),
    };
  }

  whenIdle() {
    return this.#tail;
  }

  authorize(projectId: string) {
    if (projectId !== this.#snapshot.manifest.projectId) {
      throw new ProjectError("PROJECT_SCOPE", "The request does not identify the open project.");
    }
    return this.#snapshot;
  }

  execute(input: unknown, onSaving?: () => () => void): Promise<Commit> {
    const command = commandSchema.parse(input);
    return this.#enqueue(async () => {
      const { manifest, sources } = this.authorize(command.projectId);
      const fingerprint = digest(canonical(command));
      const previous = manifest.commands.find(
        ({ result }) => result.commandId === command.commandId,
      );
      if (previous) {
        if (previous.digest !== fingerprint)
          throw new ProjectError(
            "COMMAND_ID_REUSED",
            "That command ID was already used with different arguments.",
          );
        return previous.result;
      }
      if (manifest.revision !== command.expectedRevision) {
        throw new ProjectError(
          "REVISION_CONFLICT",
          "Refresh the project revision and issue a new command.",
          manifest.revision,
        );
      }

      const atRevision = manifest.revision + 1;
      if (!revision.safeParse(atRevision).success)
        throw new ProjectError("PROJECT_CAPACITY", "Project revision capacity reached.");
      const boards = [...manifest.artboards];
      const nextSources = new Map(sources);
      const operation = command.operation;
      const { defaultPageId, pages } = this.pageLayout;
      const tokenVersion = manifest.schemaVersion === 5 || operation === "replace_project_tokens";
      const paged =
        tokenVersion ||
        manifest.schemaVersion === 4 ||
        operation === "create_page" ||
        operation === "rename_page" ||
        operation === "delete_page";
      const pageOf = (board: Artboard) => board.pageId ?? defaultPageId;
      function requirePage(pageId: string) {
        const page = pages.find(({ id }) => id === pageId);
        if (!page)
          throw new ProjectError("PAGE_NOT_FOUND", "The destination page no longer exists.");
        return page;
      }
      let entry: HistoryEntry;
      if (operation === "undo" || operation === "redo") {
        const history = operation === "undo" ? this.#undo : this.#redo;
        const saved = history.at(-1);
        if (!saved) throw new ProjectError("HISTORY_EMPTY", `Nothing to ${operation}.`);
        if (
          operation === "undo" &&
          command.arguments.targetCommandId &&
          saved.commandId !== command.arguments.targetCommandId
        ) {
          throw new ProjectError(
            "UNDO_CONFLICT",
            "Another edit is next in the undo history.",
            manifest.revision,
          );
        }
        entry = saved.entry;
      } else if (operation === "create_page") {
        entry = { page: { after: { id: randomUUID(), name: command.arguments.name } } };
      } else if (operation === "rename_page") {
        const before = requirePage(command.arguments.pageId);
        entry = { page: { before, after: { ...before, name: command.arguments.name } } };
      } else if (operation === "delete_page") {
        const page = requirePage(command.arguments.pageId);
        if (pages.length === 1)
          throw new ProjectError("LAST_PAGE", "Keep at least one page in the project.");
        const index = pages.findIndex(({ id }) => id === page.id);
        const remaining = pages.filter(({ id }) => id !== page.id);
        entry = {
          deletedPage: {
            page,
            index,
            previousDefault: defaultPageId,
            nextDefault:
              page.id === defaultPageId
                ? remaining[Math.min(index, remaining.length - 1)].id
                : defaultPageId,
            artboards: readBoards(
              this.#snapshot,
              boards.filter((board) => pageOf(board) === page.id).map(({ id }) => id),
            ),
          },
        };
      } else if (operation === "replace_project_tokens") {
        try {
          entry = {
            tokens: {
              before: this.#snapshot.tokens,
              after: await compileTokens(command.arguments.document),
            },
          };
        } catch (error) {
          if (error instanceof TokenError) throw new ProjectError("INVALID_TOKENS", error.message);
          throw error;
        }
      } else if (operation === "move_artboards_to_page") {
        const { artboardIds, pageId } = command.arguments;
        requirePage(pageId);
        const selected = readBoards(this.#snapshot, artboardIds);
        if (selected.some(({ before }) => pageOf(before.board) === pageId))
          throw new ProjectError("PAGE_UNCHANGED", "A selected artboard is already on that page.");
        entry = selected.map(({ index, before }) => ({
          index,
          before,
          after: { ...before, board: { ...before.board, pageId } },
        }));
      } else if (operation === "delete_artboard" || operation === "delete_artboards") {
        entry = readBoards(
          this.#snapshot,
          operation === "delete_artboard"
            ? [command.arguments.artboardId]
            : command.arguments.artboardIds,
        );
      } else if (operation === "move_artboards") {
        const { artboardIds, dx, dy } = command.arguments;
        const selected = readBoards(this.#snapshot, artboardIds);
        const offset = translation(
          selected.map(({ before }) => before.board),
          dx,
          dy,
        );
        entry = selected.map(({ index, before }) => ({
          index,
          before,
          after: {
            ...before,
            board: { ...before.board, ...translatedPosition(before.board, offset) },
          },
        }));
      } else if (operation === "update_artboard" || operation === "update_artboards") {
        const updates =
          operation === "update_artboard" ? [command.arguments] : command.arguments.updates;
        const patches = new Map(updates.map(({ artboardId, patch }) => [artboardId, patch]));
        const selected = readBoards(this.#snapshot, [...patches.keys()]);
        entry = selected.flatMap((previous) => {
          const { board, source } = previous.before;
          const { name, x, y, width, height } = board;
          const original = { name, x, y, width, height, ...source };
          const patch = patches.get(board.id)!;
          if (
            operation === "update_artboards" &&
            (Object.keys(patch) as (keyof BoardInput)[]).every(
              (key) => original[key] === patch[key],
            )
          )
            return [];
          const next = metadata(board.id, atRevision, { ...original, ...patch }, board.pageId);
          return [{ ...previous, after: { board: next.artboard, source: next.source } }];
        });
        if (!entry.length)
          throw new ProjectError(
            "ARTBOARDS_UNCHANGED",
            "All requested artboards already match their patches.",
          );
      } else {
        let inputs: BoardInput[];
        let destination = defaultPageId;
        if (operation === "create_artboard") {
          const { pageId = defaultPageId, ...input } = command.arguments;
          requirePage(pageId);
          destination = pageId;
          inputs = [input];
        } else {
          let originals: ArtboardState[];
          if (operation === "paste_artboard") {
            if (this.#clipboard?.id !== command.arguments.clipboardId)
              throw new ProjectError("CLIPBOARD_EMPTY", "Copy an artboard in this project first.");
            originals = this.#clipboard.originals;
            destination = command.arguments.pageId ?? defaultPageId;
            requirePage(destination);
          } else {
            const ids =
              operation === "duplicate_artboard"
                ? [command.arguments.artboardId]
                : command.arguments.artboardIds;
            originals = readBoards(this.#snapshot, ids).map(({ before }) => before);
            destination = pageOf(originals[0].board);
            if (originals.some(({ board }) => pageOf(board) !== destination))
              throw new ProjectError(
                "PAGE_MISMATCH",
                "Select artboards from one page to duplicate.",
              );
          }
          const offset = copyOffset(
            originals.map(({ board }) => board),
            boards.filter((board) => pageOf(board) === destination),
          );
          inputs = originals.map((original) => copyInput(original, offset));
        }
        entry = inputs.map((input, index) => {
          const { artboard, source } = metadata(
            randomUUID(),
            atRevision,
            input,
            paged ? destination : undefined,
          );
          return { index: boards.length + index, after: { board: artboard, source } };
        });
      }
      const undo = operation === "undo";
      const receipt = {
        status: "committed" as const,
        projectId: command.projectId,
        commandId: command.commandId,
        revision: atRevision,
      };
      let nextPages = pages;
      let nextDefaultPageId = defaultPageId;
      let nextTokens = this.#snapshot.tokens;
      let result: Commit;
      if (Array.isArray(entry)) {
        const affected = applyHistory(
          entry,
          undo,
          boards,
          nextSources,
          atRevision,
          paged ? defaultPageId : undefined,
        );
        result = {
          ...receipt,
          artboard: affected[0],
          ...(affected.length > 1 ? { artboards: affected } : {}),
        };
      } else if ("deletedPage" in entry) {
        const { page, index, previousDefault, nextDefault, artboards } = entry.deletedPage;
        if (undo) {
          nextPages = [...pages];
          nextPages.splice(index, 0, page);
        } else {
          nextPages = pages.filter(({ id }) => id !== page.id);
        }
        nextDefaultPageId = undo ? previousDefault : nextDefault;
        applyHistory(artboards, undo, boards, nextSources, atRevision, nextDefaultPageId);
        result = { ...receipt, page };
      } else if ("page" in entry) {
        const { before, after } = entry.page;
        const page = undo ? before : after;
        if (before) {
          nextPages = pages.map((current) =>
            current.id === after.id ? (page ?? current) : current,
          );
        } else {
          nextPages = undo ? pages.filter(({ id }) => id !== after.id) : [...pages, after];
        }
        result = { ...receipt, page: page ?? after };
      } else {
        nextTokens = undo ? entry.tokens.before : entry.tokens.after;
        result = { ...receipt, tokens: nextTokens?.stamp ?? null };
      }
      let nextVersion = manifest.schemaVersion;
      if (tokenVersion) nextVersion = 5;
      else if (paged) nextVersion = 4;
      else if ("artboards" in result && result.artboards) nextVersion = 3;
      else if (
        nextVersion === 1 &&
        (operation === "delete_artboard" ||
          operation === "delete_artboards" ||
          operation === "undo" ||
          operation === "redo")
      )
        nextVersion = 2;
      const next = {
        manifest: {
          ...manifest,
          tokens: nextTokens?.stamp,
          schemaVersion: nextVersion,
          revision: atRevision,
          ...(paged ? { pageLayout: { defaultPageId: nextDefaultPageId, pages: nextPages } } : {}),
          artboards: paged
            ? boards.map((board) =>
                board.pageId ? board : { ...board, pageId: nextDefaultPageId },
              )
            : boards,
          commands: [...manifest.commands, { digest: fingerprint, result }],
        },
        sources: nextSources,
        tokens: nextTokens,
      };
      const finishActivity = onSaving?.();
      try {
        if (this.sqlite)
          saveSqliteProject(this.root, this.sqlite, this.#snapshot, next, () =>
            this.onPhase?.("snapshotWritten"),
          );
        else await publishFolderSnapshot(this.root, next, this.onPhase);
      } catch {
        throw new ProjectError(
          "SAVE_FAILED",
          "The project could not be saved. The last committed revision is still open.",
        );
      } finally {
        finishActivity?.();
      }
      this.#snapshot = next;
      if (operation === "undo") {
        this.#redo.push(this.#undo.pop()!);
      } else {
        if (operation === "redo") this.#undo.push(this.#redo.pop()!);
        else {
          this.#redo.length = 0;
          this.#undo.push({ commandId: command.commandId, entry });
        }
        if (this.#undo.length > historyLimit) this.#undo.shift();
      }
      this.onPhase?.("pointerPublished");
      return result;
    });
  }

  rename(previous: string, name: string) {
    const label = projectLabel.parse({ name });
    const bytes = prepareBytes(label);
    return this.#enqueue(async () => {
      if (this.name === label.name) return;
      if (this.name !== previous)
        throw new ProjectError("NAME_CHANGED", "The project was renamed while you were editing.");
      if (this.sqlite) {
        try {
          renameSqliteProject(
            this.root,
            this.sqlite,
            this.#snapshot.manifest.projectId,
            previous,
            label.name,
          );
        } catch {
          throw new ProjectError("SAVE_FAILED", "The project name could not be saved.");
        }
        this.displayName = label.name;
        return;
      }
      try {
        await renameFolderProject(this.root, bytes);
      } catch {
        throw new ProjectError("SAVE_FAILED", "The project name could not be saved.");
      }
      this.displayName = label.name;
    });
  }

  #enqueue<T>(run: () => T | Promise<T>) {
    const job = this.#tail.then(run);
    this.#tail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }
}
