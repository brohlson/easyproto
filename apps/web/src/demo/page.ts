export type Board = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type Frame = "none" | "phone" | "laptop";
export type Scope = "canvas" | "overview" | "today";

export type DemoPage =
  | { kind: "home"; email: string }
  | { kind: "inbox"; email: string; link?: string }
  | { kind: "confirm"; action: string; button: string; details: string }
  | { kind: "publisher"; revision: number; shares: { id: string; scope: Scope; frame: Frame }[] }
  | { kind: "created"; link: string }
  | {
      kind: "viewer";
      title: string;
      revision: number;
      id: string;
      scope: Scope;
      frame: Frame;
      boards: Board[];
    }
  | { kind: "unavailable" };

export const scopeLabels: Record<Scope, string> = {
  canvas: "Project canvas",
  overview: "Overview artboard",
  today: "Today artboard",
};
export const frameLabels: Record<Frame, string> = {
  none: "No frame",
  phone: "Phone",
  laptop: "Laptop",
};
