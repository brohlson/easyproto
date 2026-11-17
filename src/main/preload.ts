import { contextBridge, ipcRenderer } from "electron";
import type { AgentProfilesState } from "../shared/agents";
import type { ChatUpdate } from "../shared/chat";
import { ipc, type DesktopBridge, type DesktopState } from "../shared/model";

const bridge: DesktopBridge = {
  getScene: () => ipcRenderer.invoke(ipc.scene),
  agents: (action) => ipcRenderer.invoke(ipc.agents, action),
  onAgents(handler) {
    const receive = (_event: Electron.IpcRendererEvent, state: AgentProfilesState) =>
      handler(state);
    ipcRenderer.on(ipc.agentsChanged, receive);
    return () => ipcRenderer.removeListener(ipc.agentsChanged, receive);
  },
  selectChatAgent: (generation, id) => ipcRenderer.invoke(ipc.chatSelect, generation, id),
  getChat: (generation) => ipcRenderer.invoke(ipc.chat, generation),
  startChat: (generation, request) => ipcRenderer.invoke(ipc.chatStart, generation, request),
  decideChat: (generation, turnId, decision) =>
    ipcRenderer.invoke(ipc.chatDecide, generation, turnId, decision),
  onChat(listener) {
    const accept = (_event: Electron.IpcRendererEvent, update: ChatUpdate) => listener(update);
    ipcRenderer.on(ipc.chatChanged, accept);
    return () => ipcRenderer.removeListener(ipc.chatChanged, accept);
  },
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
