import { z } from "zod";
import { artboardSize } from "./artboard-size";

export const id = z.uuid();
export const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const coordinate = z.number().min(-100_000).max(100_000);
const dimension = z.number().int().min(artboardSize.min).max(artboardSize.max);
export const layout = z.strictObject({
  name: z.string().trim().min(1).max(100),
  x: coordinate,
  y: coordinate,
  width: dimension,
  height: dimension,
});
export const geometryPatch = layout.omit({ name: true }).partial().refine((patch) => Object.keys(patch).length > 0);
export type GeometryPatch = z.infer<typeof geometryPatch>;
const utf8 = (value: string) => !/[\uD800-\uDFFF]/u.test(value);
export const source = z.strictObject({
  html: z.string().max(256_000).refine(utf8, "HTML must be valid Unicode."),
  css: z.string().max(128_000).refine(utf8, "CSS must be valid Unicode."),
});
export const boardInput = layout.extend(source.shape);
export const boardPatch = boardInput.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Supply at least one artboard change.",
);
export const envelope = z.strictObject({ projectId: id, commandId: id, expectedRevision: revision });
export const commandSchema = z.discriminatedUnion("operation", [
  envelope.extend({ operation: z.literal("create_artboard"), arguments: boardInput }),
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
  status: z.literal("committed"), projectId: id, commandId: id,
  revision, artboard: boardSchema,
});
export const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1), projectId: id, revision,
  artboards: z.array(boardSchema),
  commands: z.array(z.strictObject({ digest: sha256, result: commitSchema })),
});

export type Command = z.infer<typeof commandSchema>;
export type Artboard = z.infer<typeof boardSchema>;
export type Source = z.infer<typeof source>;
export type Commit = z.infer<typeof commitSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Scene = {
  generation: number;
  projectId: string;
  revision: number;
  folderName: string;
  artboards: (Artboard & { previewUrl: string })[];
};
export type DesktopBridge = {
  getScene(): Promise<Scene>;
  onScene(listener: (scene: Scene) => void): () => void;
  arrangeArtboard(generation: number, command: Command): Promise<Commit>;
  chooseProject(mode: "create" | "open"): Promise<void>;
};

export const ipc = {
  scene: "project:scene", changed: "project:changed", arrange: "project:arrange", choose: "project:choose",
} as const;
