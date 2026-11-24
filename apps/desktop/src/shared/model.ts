import { z } from "zod";
import { artboardSize } from "./artboard-size";
import { tokenByteLimit, type TokenView } from "./token-types";
import type { WebPreviewInfo } from "@easy-proto/preview";

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
export const createArtboardInput = boardInput.extend({ pageId: id.optional() });
export const boardPatch = boardInput
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Supply at least one artboard change.");
export const envelope = z.strictObject({
  projectId: id,
  commandId: id,
  expectedRevision: revision,
});
export const artboardUpdate = z.strictObject({ artboardId: id, patch: boardPatch });
export const batchUpdateInput = z.strictObject({
  updates: z
    .array(artboardUpdate)
    .min(1)
    .max(50)
    .refine(
      (updates) => new Set(updates.map((update) => update.artboardId)).size === updates.length,
      "Artboard IDs must be unique.",
    ),
});
export const artboardIds = z
  .array(id)
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, "Artboard IDs must be unique.");
export const guardedUndoInput = z.strictObject({ targetCommandId: id });
export const commandSchema = z.discriminatedUnion("operation", [
  envelope.extend({ operation: z.literal("update_artboards"), arguments: batchUpdateInput }),
  envelope.extend({ operation: z.literal("create_artboard"), arguments: createArtboardInput }),
  envelope.extend({
    operation: z.literal("create_page"),
    arguments: z.strictObject({ name: projectName }),
  }),
  envelope.extend({
    operation: z.literal("rename_page"),
    arguments: z.strictObject({ pageId: id, name: projectName }),
  }),
  envelope.extend({
    operation: z.literal("delete_page"),
    arguments: z.strictObject({ pageId: id }),
  }),
  envelope.extend({
    operation: z.literal("replace_project_tokens"),
    arguments: z.strictObject({ document: z.string().max(tokenByteLimit) }),
  }),
  envelope.extend({
    operation: z.literal("move_artboards_to_page"),
    arguments: z.strictObject({ artboardIds, pageId: id }),
  }),
  envelope.extend({
    operation: z.literal("duplicate_artboard"),
    arguments: z.strictObject({ artboardId: id }),
  }),
  envelope.extend({
    operation: z.literal("paste_artboard"),
    arguments: z.strictObject({ clipboardId: id, pageId: id.optional() }),
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
    arguments: guardedUndoInput.partial(),
  }),
  envelope.extend({
    operation: z.literal("redo"),
    arguments: z.strictObject({}),
  }),
  envelope.extend({
    operation: z.literal("update_artboard"),
    arguments: artboardUpdate,
  }),
]);

export const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const tokenStampSchema = z.strictObject({ documentDigest: sha256, cssDigest: sha256 });
export const boardSchema = layout.extend({
  id,
  pageId: id.optional(),
  sourceRevision: revision,
  sourceDigest: sha256,
  htmlRef: z.string(),
  cssRef: z.string(),
});
const pageSchema = z.strictObject({ id, name: projectName });
const pageLayoutSchema = z.strictObject({
  defaultPageId: id,
  pages: z.array(pageSchema).min(1),
});
const commitBase = z.strictObject({
  status: z.literal("committed"),
  projectId: id,
  commandId: id,
  revision,
});
export const commitSchema = z.union([
  commitBase.extend({
    artboard: boardSchema,
    artboards: z.array(boardSchema).min(2).optional(),
  }),
  commitBase.extend({ page: pageSchema }),
  commitBase.extend({ tokens: tokenStampSchema.nullable() }),
]);
export const schemaVersion = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export const manifestSchema = z.strictObject({
  schemaVersion,
  projectId: id,
  revision,
  pageLayout: pageLayoutSchema.optional(),
  tokens: tokenStampSchema.optional(),
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
      | "create_page"
      | "rename_page"
      | "delete_page"
      | "replace_project_tokens"
      | "move_artboards_to_page"
      | "duplicate_artboards"
      | "delete_artboards"
      | "undo"
      | "redo";
  }
>;
export type Artboard = z.infer<typeof boardSchema>;
export type Page = z.infer<typeof pageSchema>;
export type PageLayout = z.infer<typeof pageLayoutSchema>;
export type Source = z.infer<typeof source>;
export type Commit = z.infer<typeof commitSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Scene = PageLayout & {
  view: "project";
  sceneVersion: number;
  generation: number;
  projectId: string;
  revision: number;
  name: string;
  canUndo: boolean;
  canRedo: boolean;
  tokenDigest?: string;
  agentFocus?: { sequence: number; artboardIds: string[] };
  projects: RecentProject[];
  artboards: (Artboard & { pageId: string; previewUrl: string; agentWorking: boolean })[];
};
export type RecentProject = { id: string; name: string };
export type DesktopState =
  | Scene
  | { view: "home"; sceneVersion: number; projects: RecentProject[] };
export type DesktopBridge = {
  webPreview(
    action: "status" | "sync" | "cancel" | "open" | "copy",
    generation: number,
    pageId: string,
    expectedRevision?: number,
  ): Promise<WebPreviewInfo>;
  reportVisiblePage(generation: number, pageId: string): void;
  getScene(): Promise<DesktopState>;
  onScene(listener: (scene: DesktopState) => void): () => void;
  arrangeArtboard(generation: number, command: DesktopArtboardCommand): Promise<Commit>;
  copyArtboards(generation: number, artboardIds: string[], clipboardId: string): Promise<void>;
  getTokens(generation: number): Promise<TokenView>;
  copyTokenCss(generation: number, path: string): Promise<void>;
  importTokens(generation: number): Promise<string | null>;
  exportTokens(generation: number, format: "json" | "css"): Promise<void>;
  chooseProject(mode: "create" | "open"): Promise<void>;
  saveProjectCopy(generation: number): Promise<boolean>;
  openRecentProject(id: string): Promise<void>;
  goHome(): Promise<void>;
  renameProject(generation: number, previous: string, name: string): Promise<void>;
};

export const ipc = {
  webPreview: "project:web-preview",
  visiblePage: "project:visible-page",
  scene: "project:scene",
  changed: "project:changed",
  arrange: "project:arrange",
  copy: "project:copy-artboard",
  tokens: "project:tokens",
  copyTokenCss: "project:copy-token-css",
  importTokens: "project:import-tokens",
  exportTokens: "project:export-tokens",
  choose: "project:choose",
  saveCopy: "project:save-copy",
  recent: "project:open-recent",
  home: "project:home",
  rename: "project:rename",
} as const;
