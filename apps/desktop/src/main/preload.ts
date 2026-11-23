import { contextBridge, ipcRenderer } from "electron";
import { ipc, type DesktopBridge, type DesktopState } from "../shared/model";

const bridge: DesktopBridge = {
  webPreview: (action, generation, pageId, revision) =>
    ipcRenderer.invoke(ipc.webPreview, action, generation, pageId, revision),
  reportVisiblePage: (generation, pageId) => ipcRenderer.send(ipc.visiblePage, generation, pageId),
  getScene: () => ipcRenderer.invoke(ipc.scene),
  getTokens: (generation) => ipcRenderer.invoke(ipc.tokens, generation),
  copyTokenCss: (generation, path) => ipcRenderer.invoke(ipc.copyTokenCss, generation, path),
  importTokens: (generation) => ipcRenderer.invoke(ipc.importTokens, generation),
  exportTokens: (generation, format) => ipcRenderer.invoke(ipc.exportTokens, generation, format),
  onScene(listener) {
    const accept = (_event: Electron.IpcRendererEvent, scene: DesktopState) => listener(scene);
    ipcRenderer.on(ipc.changed, accept);
    return () => {
      ipcRenderer.removeListener(ipc.changed, accept);
    };
  },
  arrangeArtboard: (generation, command) => ipcRenderer.invoke(ipc.arrange, generation, command),
  copyArtboards: (generation, artboardIds, clipboardId) =>
    ipcRenderer.invoke(ipc.copy, generation, artboardIds, clipboardId),
  chooseProject: (mode) => ipcRenderer.invoke(ipc.choose, mode),
  saveProjectCopy: (generation) => ipcRenderer.invoke(ipc.saveCopy, generation),
  openRecentProject: (id) => ipcRenderer.invoke(ipc.recent, id),
  goHome: () => ipcRenderer.invoke(ipc.home),
  renameProject: (generation, previous, name) =>
    ipcRenderer.invoke(ipc.rename, generation, previous, name),
};

contextBridge.exposeInMainWorld("easyProto", bridge);
