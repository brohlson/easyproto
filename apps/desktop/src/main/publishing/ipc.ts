import { clipboard, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { id, ipc, revision } from "../../shared/model";
import type { Project } from "../document/project";
import type { Preview } from "../previews/preview";
import {
  pageInfo,
  syncPagePreview,
  webPreviewStatus,
  type WebPreviewSettings,
} from "./web-preview";

export function registerPublishingIpc({
  allowSender,
  activeGeneration,
  state,
  preview,
  webSettings,
}: {
  allowSender(event: IpcMainInvokeEvent): void;
  activeGeneration(generation: unknown): Project;
  state: { readonly active: { signal: AbortSignal } | undefined; readonly generation: number };
  preview: Preview;
  webSettings: WebPreviewSettings | undefined;
}) {
  let pageExport: { generation: number; controller: AbortController } | undefined;
  let pendingHosted: { scope: string; requestId: string } | undefined;
  ipcMain.handle(
    ipc.webPreview,
    async (
      event,
      action: unknown,
      selectedGeneration: unknown,
      selectedPage: unknown,
      expectedRevision: unknown,
      shareAccess: unknown,
    ) => {
      allowSender(event);
      const operation = z.enum(["status", "sync", "cancel", "open", "copy"]).parse(action);
      const project = activeGeneration(selectedGeneration);
      const pageId = id.parse(selectedPage);
      if (operation === "cancel") {
        if (pageExport?.generation === state.generation) pageExport.controller.abort();
        return { configured: Boolean(webSettings), pageName: "", artboardCount: 0 };
      }
      const info = pageInfo(project, pageId, Boolean(webSettings));
      if (!webSettings) {
        if (operation === "status") return info;
        throw new Error("Start the local web environment with pnpm local:dev, then try again.");
      }
      const lifetime = state.active!.signal;
      if (operation === "sync") {
        if (pageExport) throw new Error("A page export is already running.");
        const expected = revision.parse(expectedRevision);
        const access = z.enum(["public", "protected"]).optional().parse(shareAccess);
        const scope = JSON.stringify([state.generation, pageId, expected, access]);
        if (webSettings.mode === "hosted" && pendingHosted?.scope !== scope)
          pendingHosted = { scope, requestId: randomUUID() };
        const exporting = { generation: state.generation, controller: new AbortController() };
        pageExport = exporting;
        try {
          const result = await syncPagePreview(
            project,
            expected,
            pageId,
            webSettings,
            (snapshot, board, signal) => preview.capture(project, snapshot, board, signal),
            AbortSignal.any([lifetime, exporting.controller.signal]),
            fetch,
            access,
            pendingHosted?.requestId,
          );
          pendingHosted = undefined;
          return result;
        } finally {
          if (pageExport === exporting) pageExport = undefined;
        }
      }
      const saved = await webPreviewStatus(project, pageId, webSettings, lifetime);
      activeGeneration(selectedGeneration);
      if (operation !== "status" && !saved.url)
        throw new Error("Sync this page before opening its preview.");
      if (operation === "open") await shell.openExternal(saved.url!);
      if (operation === "copy") clipboard.writeText(saved.url!);
      return saved;
    },
  );
}
