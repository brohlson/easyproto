import type { PreviewManifest } from "@easy-proto/preview";
export type SharedPage = Omit<PreviewManifest, "artboards" | "revision"> & {
  kind: "page-preview";
  id: string;
  updatedAt: string;
  artboards: (Omit<
    PreviewManifest["artboards"][number],
    "document" | "stylesheet" | "tokens" | "assets"
  > & {
    iframeUrl: string;
  })[];
};
