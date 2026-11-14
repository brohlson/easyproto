import { contextBridge, ipcRenderer } from "electron";
import { ipc, type DesktopBridge, type Scene } from "../shared/model";

const bridge: DesktopBridge = {
  getScene: () => ipcRenderer.invoke(ipc.scene),
  onScene(listener) {
    const accept = (_event: Electron.IpcRendererEvent, scene: Scene) => listener(scene);
    ipcRenderer.on(ipc.changed, accept);
    return () => { ipcRenderer.removeListener(ipc.changed, accept); };
  },
  arrangeArtboard: (generation, command) => ipcRenderer.invoke(ipc.arrange, generation, command),
  chooseProject: (mode) => ipcRenderer.invoke(ipc.choose, mode),
};

contextBridge.exposeInMainWorld("easyProto", bridge);
