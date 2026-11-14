import { z } from "zod";
import { artboardSize } from "./artboard-size";

export const id = z.uuid();
export const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const coordinateLimit = 100_000;
const coordinate = z.number().min(-coordinateLimit).max(coordinateLimit);
const dimension = z.number().int().min(artboardSize.min).max(artboardSize.max);
export const layout = z.strictObject({
  name: z.string().trim().min(1).max(100),
  x: coordinate,
  y: coordinate,
  width: dimension,
  height: dimension,
});
export const geometryPatch = layout
  .omit({ name: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0);
export type GeometryPatch = z.infer<typeof geometryPatch>;
export const projectName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\p{Cc}\uD800-\uDFFF]+$/u);
export const desktopArtboardPatch = z.union([geometryPatch, z.strictObject({ name: projectName })]);
export type DesktopArtboardPatch = z.infer<typeof desktopArtboardPatch>;
const utf8 = (value: string) => !/[\uD800-\uDFFF]/u.test(value);
export const source = z.strictObject({
  html: z.string().max(256_000).refine(utf8, "HTML must be valid Unicode."),
  css: z.string().max(128_000).refine(utf8, "CSS must be valid Unicode."),
});
export const boardInput = layout.extend(source.shape);
export const boardPatch = boardInput
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Supply at least one artboard change.");
export const envelope = z.strictObject({
  projectId: id,
  commandId: id,
  expectedRevision: revision,
});
export const artboardLimit = 50;
export const artboardIds = z
  .array(id)
  .min(1)
  .max(artboardLimit)
  .refine((ids) => new Set(ids).size === ids.length, "Artboard IDs must be unique.");
export const commandSchema = z.discriminatedUnion("operation", [
  envelope.extend({ operation: z.literal("create_artboard"), arguments: boardInput }),
  envelope.extend({
    operation: z.literal("duplicate_artboard"),
    arguments: z.strictObject({ artboardId: id }),
  }),
  envelope.extend({
    operation: z.literal("paste_artboard"),
    arguments: z.strictObject({ clipboardId: id }),
  }),
  envelope.extend({
    operation: z.literal("delete_artboard"),
    arguments: z.strictObject({ artboardId: id }),
  }),
  envelope.extend({
    operation: z.literal("move_artboards"),
    arguments: z.strictObject({ artboardIds, dx: z.number(), dy: z.number() }),
  }),
  envelope.extend({
    operation: z.literal("duplicate_artboards"),
    arguments: z.strictObject({ artboardIds }),
  }),
  envelope.extend({
    operation: z.literal("delete_artboards"),
    arguments: z.strictObject({ artboardIds }),
  }),
  envelope.extend({
    operation: z.literal("undo"),
    arguments: z.strictObject({}),
  }),
  envelope.extend({
    operation: z.literal("redo"),
    arguments: z.strictObject({}),
  }),
  envelope.extend({
    operation: z.literal("update_artboard"),
    arguments: z.strictObject({ artboardId: id, patch: boardPatch }),
  }),
]);

export const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const boardSchema = layout.extend({
  id,
  sourceRevision: revision,
  sourceDigest: sha256,
  htmlRef: z.string(),
  cssRef: z.string(),
});
export const commitSchema = z.strictObject({
  status: z.literal("committed"),
  projectId: id,
  commandId: id,
  revision,
  artboard: boardSchema,
  artboards: z.array(boardSchema).min(2).max(artboardLimit).optional(),
});
export const schemaVersion = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const manifestSchema = z.strictObject({
  schemaVersion,
  projectId: id,
  revision,
  artboards: z.array(boardSchema),
  commands: z.array(z.strictObject({ digest: sha256, result: commitSchema })),
});

export type Command = z.infer<typeof commandSchema>;
export type DesktopArtboardCommand = Extract<
  Command,
  {
    operation:
      | "update_artboard"
      | "duplicate_artboard"
      | "paste_artboard"
      | "delete_artboard"
      | "move_artboards"
      | "duplicate_artboards"
      | "delete_artboards"
      | "undo"
      | "redo";
  }
>;
export type Artboard = z.infer<typeof boardSchema>;
export type Source = z.infer<typeof source>;
export type Commit = z.infer<typeof commitSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Scene = {
  view: "project";
  sceneVersion: number;
  generation: number;
  projectId: string;
  revision: number;
  name: string;
  canUndo: boolean;
  canRedo: boolean;
  projects: RecentProject[];
  artboards: (Artboard & { previewUrl: string; agentWorking: boolean })[];
};
export type RecentProject = { id: string; name: string };
export type DesktopState =
  | Scene
  | { view: "home"; sceneVersion: number; projects: RecentProject[] };
export type DesktopBridge = {
  getScene(): Promise<DesktopState>;
  onScene(listener: (scene: DesktopState) => void): () => void;
  arrangeArtboard(generation: number, command: DesktopArtboardCommand): Promise<Commit>;
  copyArtboards(generation: number, artboardIds: string[], clipboardId: string): Promise<void>;
  chooseProject(mode: "create" | "open"): Promise<void>;
  openRecentProject(id: string): Promise<void>;
  goHome(): Promise<void>;
  renameProject(generation: number, previous: string, name: string): Promise<void>;
};

export const ipc = {
  scene: "project:scene",
  changed: "project:changed",
  arrange: "project:arrange",
  copy: "project:copy-artboard",
  choose: "project:choose",
  recent: "project:open-recent",
  home: "project:home",
  rename: "project:rename",
} as const;
