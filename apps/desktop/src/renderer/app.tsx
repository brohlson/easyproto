import { createRoot } from "react-dom/client";
import type { DesktopBridge } from "../shared/model";
import "@xyflow/react/dist/style.css";
import "./base.css";
import { ToastProvider } from "./shared/toast";
import { Workspace } from "./workspace/workspace";

declare global {
  interface Window {
    easyProto: DesktopBridge;
  }
}

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <Workspace />
  </ToastProvider>,
);
