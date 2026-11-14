import { contextBridge, ipcRenderer } from "electron";
import { ipc, type DesktopBridge, type DesktopState } from "../shared/model";

const bridge: DesktopBridge = {
  getScene: () => ipcRenderer.invoke(ipc.scene),
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
  openRecentProject: (id) => ipcRenderer.invoke(ipc.recent, id),
  goHome: () => ipcRenderer.invoke(ipc.home),
  renameProject: (generation, previous, name) =>
    ipcRenderer.invoke(ipc.rename, generation, previous, name),
};

contextBridge.exposeInMainWorld("easyProto", bridge);
