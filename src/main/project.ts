import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import {
  boardInput,
  commandSchema,
  id,
  manifestSchema,
  projectName,
  revision,
  source,
  type Artboard,
  type Commit,
  type Manifest,
  type Source,
} from "../shared/model";

export class ProjectError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly currentRevision?: number,
  ) {
    super(message);
  }
}

export function digest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value !== null && typeof value === "object") {
    return JSON.stringify(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : Number(left > right)))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return JSON.stringify(value);
}

export type Snapshot = { manifest: Manifest; sources: ReadonlyMap<string, Source> };
export type Asset = { bytes: Buffer; mime: string };
const assetTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".avif", "image/avif"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
]);
const pointerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: id,
  revision,
  snapshot: id,
});
const managed = ".easy-proto";
const projectLabel = z.strictObject({ name: projectName });
const prepareBytes = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

async function readRegular(path: string, max: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max) {
      throw new Error("Expected a regular, single-link project file within the size limit.");
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("File changed while reading.");
      offset += bytesRead;
    }
    if ((await file.stat()).size !== stat.size) throw new Error("File changed while reading.");
    return bytes;
  } finally {
    await file.close();
  }
}

async function requireDirectory(path: string) {
  if (!(await lstat(path)).isDirectory()) throw new Error("Expected a real directory.");
}

async function readAssets(root: string) {
  const assets = new Map<string, Asset>();
  let total = 0;
  let entries = 0;
  async function walk(segments: string[]) {
    if (segments.length > 12) throw new Error("The assets directory is nested too deeply.");
    const folder = join(root, "assets", ...segments);
    await requireDirectory(folder);
    for (const name of (await readdir(folder)).sort()) {
      if (++entries > 2048) throw new Error("The assets directory contains too many entries.");
      // Control characters are excluded from project asset names.
      // oxlint-disable-next-line no-control-regex
      if (name.startsWith(".") || /[\\\u0000-\u001f]/.test(name)) continue;
      const path = join(folder, name);
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) throw new Error("Project assets cannot contain symbolic links.");
      if (entry.isDirectory()) {
        await walk([...segments, name]);
        continue;
      }
      const mime = assetTypes.get(name.slice(name.lastIndexOf(".")).toLowerCase());
      if (!mime) continue;
      const bytes = await readRegular(path, 8 * 1024 * 1024);
      total += bytes.byteLength;
      if (total > 32 * 1024 * 1024) throw new Error("Project assets exceed 32 MiB.");
      assets.set([...segments, name].join("/"), { bytes, mime });
    }
  }
  try {
    await lstat(join(root, "assets"));
  } catch (error) {
    if (missing(error)) return assets;
    throw error;
  }
  await walk([]);
  return assets;
}

function metadata(artboardId: string, atRevision: number, input: z.infer<typeof boardInput>) {
  const { html, css, ...bounds } = input;
  const artboard: Artboard = {
    ...bounds,
    id: artboardId,
    sourceRevision: atRevision,
    sourceDigest: digest(canonical({ html, css })),
    htmlRef: `${artboardId}.html`,
    cssRef: `${artboardId}.css`,
  };
  return { artboard, source: { html, css } };
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

async function load(root: string): Promise<Snapshot> {
  const pointer = pointerSchema.parse(
    JSON.parse((await readRegular(join(root, "project.json"), 4096)).toString()),
  );
  await requireDirectory(join(root, managed));
  const folder = join(root, managed, pointer.snapshot);
  await requireDirectory(folder);
  const manifest = manifestSchema.parse(
    JSON.parse((await readRegular(join(folder, "manifest.json"), 32 * 1024 * 1024)).toString()),
  );
  if (manifest.revision !== pointer.revision || manifest.projectId !== pointer.projectId) {
    throw new Error("Project pointer and revision disagree.");
  }
  const sources = new Map<string, Source>();
  for (const board of manifest.artboards) {
    if (
      sources.has(board.id) ||
      board.htmlRef !== `${board.id}.html` ||
      board.cssRef !== `${board.id}.css` ||
      board.sourceRevision > manifest.revision
    )
      throw new Error("Invalid artboard metadata.");
    const content = source.parse({
      html: (await readRegular(join(folder, board.htmlRef), 1024 * 1024)).toString(),
      css: (await readRegular(join(folder, board.cssRef), 512 * 1024)).toString(),
    });
    if (board.sourceDigest !== digest(canonical(content)))
      throw new Error("Artboard source has changed on disk.");
    sources.set(board.id, content);
  }
  const commands = new Set<string>();
  for (const { result } of manifest.commands) {
    if (
      commands.has(result.commandId) ||
      result.projectId !== manifest.projectId ||
      result.revision < 1 ||
      result.revision > manifest.revision ||
      !sources.has(result.artboard.id)
    ) {
      throw new Error("Invalid command history.");
    }
    commands.add(result.commandId);
  }
  return { manifest, sources };
}

async function readName(root: string) {
  try {
    const bytes = await readRegular(join(root, managed, "name.json"), 4096);
    return projectLabel.parse(JSON.parse(bytes.toString())).name;
  } catch (error) {
    if (!missing(error)) throw error;
    return basename(root);
  }
}

type CommitPhase = "snapshotWritten" | "pointerPublished";

async function publish(root: string, snapshot: Snapshot, onPhase?: (phase: CommitPhase) => void) {
  await requireDirectory(join(root, managed));
  const key = randomUUID();
  const folder = join(root, managed, key);
  const pending = join(root, `.project-${key}.tmp`);
  const { manifest, sources } = snapshot;
  const { schemaVersion, projectId, revision } = manifest;
  const serialized = prepareBytes(manifest);
  if (Buffer.byteLength(serialized) > 32 * 1024 * 1024)
    throw new Error("Project history capacity reached.");
  await mkdir(folder);
  try {
    for (const board of manifest.artboards) {
      const data = sources.get(board.id)!;
      await writeFile(join(folder, board.htmlRef), data.html, { flag: "wx", flush: true });
      await writeFile(join(folder, board.cssRef), data.css, { flag: "wx", flush: true });
    }
    await writeFile(join(folder, "manifest.json"), serialized, { flag: "wx", flush: true });
    await writeFile(pending, prepareBytes({ schemaVersion, projectId, revision, snapshot: key }), {
      flag: "wx",
      flush: true,
    });
    onPhase?.("snapshotWritten");
    await rename(pending, join(root, "project.json"));
  } catch (error) {
    await Promise.allSettled([
      rm(folder, { recursive: true, force: true }),
      rm(pending, { force: true }),
    ]);
    throw error;
  }
}

export class Project {
  #tail = Promise.resolve();
  #snapshot: Snapshot;
  readonly assetDigest: string;

  private constructor(
    readonly root: string,
    snapshot: Snapshot,
    readonly assets: ReadonlyMap<string, Asset>,
    private displayName: string,
    private readonly onPhase?: (phase: CommitPhase) => void,
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
        await publish(root, snapshot);
      } catch (error) {
        if (!hasManagedFolder) await rmdir(join(root, managed)).catch(() => undefined);
        throw error;
      }
      return new Project(root, snapshot, assets, basename(root), onPhase);
    }
    if (mode === "create") throw new Error("This folder already contains a project.");
    return new Project(
      root,
      await load(root),
      await readAssets(root),
      await readName(root),
      onPhase,
    );
  }

  get snapshot() {
    return this.#snapshot;
  }

  get name() {
    return this.displayName;
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

  execute(input: unknown): Promise<Commit> {
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
      let board: Artboard;
      if (command.operation === "create_artboard") {
        if (boards.length >= 50)
          throw new ProjectError("PROJECT_CAPACITY", "This slice supports up to 50 artboards.");
        const created = metadata(randomUUID(), atRevision, command.arguments);
        board = created.artboard;
        boards.push(board);
        nextSources.set(board.id, created.source);
      } else {
        const { artboardId, patch } = command.arguments;
        const index = boards.findIndex((item) => item.id === artboardId);
        if (index < 0) throw new ProjectError("ARTBOARD_NOT_FOUND", "The artboard does not exist.");
        const previousBoard = boards[index];
        const previousSource = sources.get(artboardId)!;
        const input = boardInput.parse({
          name: previousBoard.name,
          x: previousBoard.x,
          y: previousBoard.y,
          width: previousBoard.width,
          height: previousBoard.height,
          ...previousSource,
          ...patch,
        });
        const updated = metadata(artboardId, atRevision, input);
        board = updated.artboard;
        if (board.sourceDigest === previousBoard.sourceDigest)
          board.sourceRevision = previousBoard.sourceRevision;
        boards[index] = board;
        nextSources.set(board.id, updated.source);
      }
      const result: Commit = {
        status: "committed",
        projectId: command.projectId,
        commandId: command.commandId,
        revision: atRevision,
        artboard: board,
      };
      const next = {
        manifest: {
          ...manifest,
          revision: atRevision,
          artboards: boards,
          commands: [...manifest.commands, { digest: fingerprint, result }],
        },
        sources: nextSources,
      };
      try {
        await publish(this.root, next, this.onPhase);
      } catch {
        throw new ProjectError(
          "SAVE_FAILED",
          "The project could not be saved. The last committed revision is still open.",
        );
      }
      this.#snapshot = next;
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
      const folder = join(this.root, managed);
      const pending = join(folder, `.name-${randomUUID()}.tmp`);
      try {
        await requireDirectory(folder);
        await writeFile(pending, bytes, { flag: "wx", flush: true });
        await rename(pending, join(folder, "name.json"));
      } catch {
        await rm(pending, { force: true }).catch(() => undefined);
        throw new ProjectError("SAVE_FAILED", "The project name could not be saved.");
      }
      this.displayName = label.name;
    });
  }

  #enqueue<T>(run: () => Promise<T>) {
    const job = this.#tail.then(run);
    this.#tail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }
}
