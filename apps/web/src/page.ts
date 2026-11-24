import type { DemoPage } from "./demo/page";
import type { SharedPage } from "./shared-viewer/page";

export type Page = { kind: "landing" } | SharedPage | DemoPage;
