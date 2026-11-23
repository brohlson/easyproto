import { z } from "zod";

export const previewLimits = {
  boards: 50,
  imageBytes: 8 * 1024 * 1024,
  uploadBytes: 32 * 1024 * 1024,
};
const name = z.string().trim().min(1).max(100);
export const previewManifest = z
  .strictObject({
    schemaVersion: z.literal(1),
    projectName: name,
    pageName: name,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    artboards: z
      .array(
        z.strictObject({
          id: z.uuid(),
          name,
          x: z.number().min(-100_000).max(100_000),
          y: z.number().min(-100_000).max(100_000),
          width: z.number().int().min(100).max(2560),
          height: z.number().int().min(100).max(2560),
          digest: z.string().regex(/^[a-f0-9]{64}$/),
          bytes: z.number().int().positive().max(previewLimits.imageBytes),
        }),
      )
      .min(1)
      .max(previewLimits.boards),
  })
  .refine(
    (manifest) =>
      new Set(manifest.artboards.map(({ id }) => id)).size === manifest.artboards.length,
    "Artboard IDs must be unique.",
  );
export const pageUpload = z.strictObject({
  projectId: z.uuid(),
  pageId: z.uuid(),
  manifest: previewManifest,
});
export type PreviewManifest = z.infer<typeof previewManifest>;
export type PageUpload = z.infer<typeof pageUpload>;
export type WebPreviewInfo = {
  configured: boolean;
  pageName: string;
  artboardCount: number;
  url?: string;
  revision?: number;
  updatedAt?: string;
};

export function pngDimensions(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !signature.every((byte, index) => bytes[index] === byte))
    throw new Error("Invalid PNG image.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452)
    throw new Error("Invalid PNG header.");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
