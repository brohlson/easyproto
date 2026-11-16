import { Brand } from "@easy-proto/ui";
import { Folder, MessageSquare, Plus } from "lucide-react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Background,
  ReactFlow,
  SelectionMode,
  ViewportPortal,
  getNodesBounds,
  applyNodeChanges,
  useNodesState,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import type {
  DesktopArtboardCommand,
  DesktopArtboardPatch,
  DesktopBridge,
  DesktopState,
  Page,
  Scene,
} from "../shared/model";
import "@xyflow/react/dist/style.css";
import "virtual:desktop-design-tokens.css";
import "./styles.css";
import type { AgentProfilesState } from "../shared/agents";
import { AgentSettings } from "./agent-settings";
import { ChatDock } from "./chat";
import { DevicePresets } from "./device-presets";
import { EditableName } from "./editable-name";
import { MoveToPage, PagePicker } from "./pages";
import { Settings, type Theme } from "./settings";
import { TokenManager } from "./tokens";
import { ToastProvider } from "./toast";

declare global {
  interface Window {
    easyProto: DesktopBridge;
  }
}

type Board = Scene["artboards"][number];
const artboardClipboardType = "application/x-easy-proto-artboard";
type BoardNode = Node<Board, "artboard">;
type ArtboardChange = {
  [C in DesktopArtboardCommand as C["operation"]]: Pick<C, "operation" | "arguments">;
}[DesktopArtboardCommand["operation"]];
const ArtboardEditing = createContext<{
  disabled: boolean;
  begin(id: string): ((patch: DesktopArtboardPatch) => void) | undefined;
  focusCopy(id: string): boolean;
} | null>(null);

function ArtboardPreview({ board }: { board: Board }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="artboard-preview" data-loaded={loaded}>
      <iframe
        className={board.agentWorking ? "artboard-preview-working" : undefined}
        title={board.name}
        src={board.previewUrl}
        sandbox=""
        tabIndex={-1}
        width={board.width}
        height={board.height}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

const ArtboardNode = memo(function ArtboardNode({ id, data, selected }: NodeProps<BoardNode>) {
  const editing = useContext(ArtboardEditing)!;
  const zoom = useStore((state) => state.transform[2]);
  const artboard = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (selected && editing.focusCopy(id))
      artboard.current?.closest<HTMLElement>(".react-flow__node")?.focus({ preventScroll: true });
  }, [selected]);

  return (
    <div ref={artboard} className="artboard">
      <div
        className="artboard-meta"
        style={
          {
            "--inverse-zoom": 1 / zoom,
            "--label-width": `${Math.max(172, data.width * zoom)}px`,
          } as CSSProperties
        }
      >
        <div className="artboard-activity" role="status">
          {data.agentWorking && (
            <span>
              Agent working<span className="screen-reader-only"> on {data.name}</span>
              <span className="activity-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </span>
          )}
        </div>
        <div className="artboard-label">
          <EditableName
            kind="artboard"
            name={data.name}
            disabled={editing.disabled}
            begin={() => {
              const save = editing.begin(id);
              return save && ((name) => save({ name }));
            }}
          />
          <DevicePresets
            width={data.width}
            height={data.height}
            disabled={editing.disabled}
            begin={() => editing.begin(id)}
          />
        </div>
      </div>
      <ArtboardPreview key={data.previewUrl} board={data} />
    </div>
  );
});

const nodeTypes = { artboard: ArtboardNode };

function GroupOutline({ selection }: { selection: BoardNode[] }) {
  const selecting = useStore((state) => state.userSelectionActive);
  if (selecting || selection.length < 2) return null;
  const { x, y, width, height } = getNodesBounds(selection);
  return (
    <ViewportPortal>
      <div
        className="artboard-group-outline"
        aria-hidden="true"
        style={{ left: x, top: y, width, height }}
      />
    </ViewportPortal>
  );
}

const arrows = new Map([
  ["ArrowUp", { x: 0, y: -1 }],
  ["ArrowDown", { x: 0, y: 1 }],
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
]);

function FitShortcut() {
  const { fitView, getViewport, setViewport } = useReactFlow();
  const width = useStore((state) => state.width);
  const previousWidth = useRef(width);

  useLayoutEffect(() => {
    const previous = previousWidth.current;
    previousWidth.current = width;
    if (!previous || !width || previous === width) return;
    const viewport = getViewport();
    void setViewport({ ...viewport, x: viewport.x + (width - previous) / 2 });
  }, [width, getViewport, setViewport]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (
        event.code !== "Digit0" ||
        !event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest(
            "input, select, textarea, [contenteditable], [popover], .chat-dock",
          )) ||
        document.querySelector(":popover-open, dialog[open]")
      )
        return;
      event.preventDefault();
      void fitView({ padding: 0.4, maxZoom: 1 });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fitView]);
  return null;
}

function App() {
  const [desktop, setDesktop] = useState<DesktopState>();
  const [agents, setAgents] = useState<AgentProfilesState>();
  const focusAgents = useRef(false);
  useEffect(() => {
    let current = true;
    const dispose = window.easyProto.onAgents(setAgents);
    void window.easyProto.agents({ action: "status" }).then(
      (value) => {
        if (current) setAgents(value);
      },
      () => {
        if (current)
          setAgents({
            profiles: [],
            codexInstalled: false,
            claudeInstalled: false,
            message: "Could not load agent profiles.",
          });
      },
    );
    return () => {
      current = false;
      dispose();
    };
  }, []);
  useEffect(() => {
    if (desktop?.view === "home" && focusAgents.current) {
      focusAgents.current = false;
      document.getElementById("agents-title")?.focus();
    }
  }, [desktop?.view]);
  const scene = desktop?.view === "project" ? desktop : undefined;
  const [openChatGeneration, setOpenChatGeneration] = useState<number>();
  const chatTrigger = useRef<HTMLButtonElement>(null);
  const chatOpen = scene !== undefined && openChatGeneration === scene.generation;
  const [nodes, setNodes] = useNodesState<BoardNode>([]);
  const [message, setMessage] = useState("");
  const [activePageId, setActivePageId] = useState<string>();
  const [pageMove, setPageMove] = useState<{ page: Page; count: number }>();
  const [saving, setSaving] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const colorMode = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const savingGeneration = useRef<number>(null);
  const latest = useRef<Scene>(null);
  const receivedVersion = useRef(-1);
  const visiblePage = useRef<string>(null);
  const cameras = useRef(new Map<string, Viewport>());
  const drag = useRef<{ ids: Set<string>; scene: Scene }>(null);
  const pendingSelection = useRef<{ ids: Set<string>; focusId: string }>(null);
  const clipboard = useRef<{ id: string; ready: Promise<boolean> }>(null);

  function reconcile(currentScene: Scene, reset = false) {
    const dragging = drag.current?.ids;
    const selection = pendingSelection.current;
    const boards = currentScene.artboards.filter(({ pageId }) => pageId === visiblePage.current);
    const select = selection && boards.some(({ id }) => id === selection.focusId);
    setNodes((currentNodes) =>
      boards.map((board) => {
        const existing = reset ? undefined : currentNodes.find((node) => node.id === board.id);
        const position =
          dragging?.has(board.id) && existing ? existing.position : { x: board.x, y: board.y };
        return {
          ...existing,
          id: board.id,
          type: "artboard",
          data: board,
          width: board.width,
          height: board.height,
          ariaLabel: board.name,
          position,
          selected: select ? selection.ids.has(board.id) : existing?.selected,
        };
      }),
    );
  }

  function showPage(current: Scene, pageId: string) {
    visiblePage.current = pageId;
    pendingSelection.current = null;
    setActivePageId(pageId);
    setPageMove(undefined);
    reconcile(current, true);
  }

  function receive(next: DesktopState) {
    if (next.sceneVersion <= receivedVersion.current) return;
    receivedVersion.current = next.sceneVersion;
    const current = next.view === "project" ? next : null;
    const reset = current?.generation !== latest.current?.generation;
    if (reset) {
      drag.current = null;
      pendingSelection.current = null;
      clipboard.current = null;
      savingGeneration.current = null;
      visiblePage.current = null;
      cameras.current.clear();
      setSaving(false);
      setMessage("");
      setPageMove(undefined);
    }
    latest.current = current;
    setDesktop(next);
    if (current) {
      if (!current.pages.some(({ id }) => id === visiblePage.current))
        showPage(current, current.defaultPageId);
      else reconcile(current);
    } else {
      setActivePageId(undefined);
      setNodes([]);
    }
  }

  useEffect(() => {
    const unsubscribe = window.easyProto.onScene(receive);
    window.easyProto
      .getScene()
      .then(receive)
      .catch(() => setMessage("The project could not be loaded."));
    return unsubscribe;
  }, []);

  useEffect(() => {
    const preference = matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = colorMode;
  }, [colorMode]);

  async function saveCommand(change: ArtboardChange, from: Scene) {
    if (
      latest.current?.generation !== from.generation ||
      savingGeneration.current !== null ||
      choosing
    )
      return false;
    savingGeneration.current = from.generation;
    setSaving(true);
    setMessage("");
    setPageMove(undefined);
    const originPage = visiblePage.current;
    try {
      const commit = await window.easyProto.arrangeArtboard(from.generation, {
        projectId: from.projectId,
        commandId: crypto.randomUUID(),
        expectedRevision: from.revision,
        ...change,
      });
      if (latest.current?.generation !== from.generation) return false;
      if (change.operation === "create_page" && "page" in commit) {
        const pageId = commit.page.id;
        if (!latest.current.pages.some(({ id }) => id === pageId)) {
          try {
            receive(await window.easyProto.getScene());
          } catch {
            if (latest.current?.generation === from.generation)
              setMessage("The page was saved. Reopen the project to refresh the page list.");
            return true;
          }
        }
        const current = latest.current;
        if (
          current?.generation === from.generation &&
          current.pages.some(({ id }) => id === pageId)
        )
          showPage(current, pageId);
      } else if (change.operation === "move_artboards_to_page") {
        const { pageId, artboardIds } = change.arguments;
        const page = from.pages.find(({ id }) => id === pageId);
        if (page) setPageMove({ page, count: artboardIds.length });
      } else if ("artboard" in commit && visiblePage.current === originPage) {
        const previousIds = new Set(
          from.artboards.filter(({ pageId }) => pageId === originPage).map(({ id }) => id),
        );
        const added = (commit.artboards ?? [commit.artboard]).filter(
          ({ id, pageId }) => (pageId ?? from.defaultPageId) === originPage && !previousIds.has(id),
        );
        if (added.length) {
          pendingSelection.current = {
            ids: new Set(added.map(({ id }) => id)),
            focusId: added[0].id,
          };
        }
      }
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("Error: ").at(-1) : undefined;
      if (latest.current?.generation === from.generation) {
        setMessage(
          detail?.includes("Refresh the project revision")
            ? "The project was updated while you were editing. Try the change again."
            : detail || "The change could not be saved.",
        );
      }
      return false;
    } finally {
      if (latest.current?.generation === from.generation) {
        savingGeneration.current = null;
        setSaving(false);
        reconcile(latest.current);
      }
    }
  }

  function arrange(artboardId: string, patch: DesktopArtboardPatch, from: Scene) {
    return saveCommand({ operation: "update_artboard", arguments: { artboardId, patch } }, from);
  }

  const selection = nodes.filter((node) => node.selected);
  function canEditCanvas(target: EventTarget | null) {
    return (
      !choosing &&
      !drag.current &&
      savingGeneration.current === null &&
      !(
        target instanceof Element &&
        target.closest("input, select, textarea, [contenteditable], [popover], .chat-dock")
      ) &&
      !document.querySelector(":popover-open, dialog[open]")
    );
  }

  const handleCopy = useEffectEvent((event: ClipboardEvent) => {
    const current = latest.current;
    if (
      !event.clipboardData ||
      !current ||
      !selection.length ||
      !canEditCanvas(event.target) ||
      window.getSelection()?.toString()
    )
      return;
    const id = crypto.randomUUID();
    event.clipboardData.clearData();
    event.clipboardData.setData(artboardClipboardType, id);
    event.preventDefault();
    const ready = window.easyProto
      .copyArtboards(
        current.generation,
        selection.map(({ id }) => id),
        id,
      )
      .then(
        () => true,
        () => {
          if (latest.current?.generation === current.generation)
            setMessage("The selection could not be copied.");
          return false;
        },
      );
    clipboard.current = { id, ready };
  });

  const handlePaste = useEffectEvent(async (event: ClipboardEvent) => {
    const current = latest.current;
    const pageId = visiblePage.current;
    const copied = clipboard.current;
    if (
      !current ||
      !copied ||
      !pageId ||
      !canEditCanvas(event.target) ||
      event.clipboardData?.getData(artboardClipboardType) !== copied.id
    )
      return;
    event.preventDefault();
    if (await copied.ready) {
      const latestScene = latest.current;
      if (latestScene?.generation === current.generation && visiblePage.current === pageId)
        void saveCommand(
          { operation: "paste_artboard", arguments: { clipboardId: copied.id, pageId } },
          latestScene,
        );
    }
  });

  const handleShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    const key = event.key.toLowerCase();
    // The macOS Delete key reports Backspace. Forward Delete reports Delete.
    const remove = key === "backspace" || key === "delete";
    const clearSelection = key === "escape" && !event.metaKey;
    const canvasCommand = event.metaKey && (key === "d" || key === "z");
    if (
      !(canvasCommand || clearSelection || (remove && !event.metaKey)) ||
      event.ctrlKey ||
      event.altKey ||
      (key !== "z" && event.shiftKey) ||
      event.repeat ||
      event.defaultPrevented ||
      event.isComposing ||
      !canEditCanvas(event.target)
    )
      return;

    const current = latest.current;
    if (!current) return;
    if (clearSelection && selection.length) {
      event.preventDefault();
      event.stopPropagation();
      setNodes((current) =>
        current.map((node) => (node.selected ? { ...node, selected: false } : node)),
      );
      return;
    }
    if (key === "z") {
      const redo = event.shiftKey;
      if (redo ? !current.canRedo : !current.canUndo) return;
      event.preventDefault();
      void saveCommand({ operation: redo ? "redo" : "undo", arguments: {} }, current);
      return;
    }
    if (!selection.length) return;
    event.preventDefault();
    const artboardIds = selection.map(({ id }) => id);
    void saveCommand(
      {
        operation: remove ? "delete_artboards" : "duplicate_artboards",
        arguments: { artboardIds },
      },
      current,
    );
  });

  useEffect(() => {
    const paste = (event: ClipboardEvent) => void handlePaste(event);
    window.addEventListener("keydown", handleShortcut, true);
    window.addEventListener("copy", handleCopy);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("keydown", handleShortcut, true);
      window.removeEventListener("copy", handleCopy);
      window.removeEventListener("paste", paste);
    };
  }, []);

  function endDrag(dragged: BoardNode[]) {
    const gesture = drag.current;
    drag.current = null;
    if (!gesture) return;
    const first = dragged.find(({ id }) => gesture.ids.has(id));
    const origin = gesture.scene.artboards.find(({ id }) => id === first?.id);
    if (!first || !origin) return;
    const dx = first.position.x - origin.x;
    const dy = first.position.y - origin.y;
    if (dx || dy) {
      void saveCommand(
        { operation: "move_artboards", arguments: { artboardIds: [...gesture.ids], dx, dy } },
        gesture.scene,
      );
    } else if (latest.current) {
      reconcile(latest.current);
    }
  }

  function moveWithKeyboard(event: KeyboardEvent) {
    const direction = arrows.get(event.key);
    if (!direction || !(event.target instanceof HTMLElement)) return;
    if (event.target.closest("button, input")) return;
    const nodeId = event.target.closest<HTMLElement>(".react-flow__node")?.dataset.id;
    const selectionFocused = event.target.classList.contains("react-flow__nodesselection-rect");
    const current = latest.current;
    if (
      !current ||
      !selection.length ||
      (!selectionFocused && !selection.some(({ id }) => id === nodeId))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (drag.current || event.repeat) return;
    const step = event.shiftKey ? 20 : 5;
    void saveCommand(
      {
        operation: "move_artboards",
        arguments: {
          artboardIds: selection.map(({ id }) => id),
          dx: direction.x * step,
          dy: direction.y * step,
        },
      },
      current,
    );
  }

  const editing = {
    disabled: saving || choosing,
    focusCopy(id: string) {
      if (pendingSelection.current?.focusId !== id) return false;
      pendingSelection.current = null;
      return true;
    },
    begin(id: string) {
      const current = latest.current;
      if (!current || choosing || drag.current || savingGeneration.current !== null) return;
      return (patch: DesktopArtboardPatch) => void arrange(id, patch, current);
    },
  };

  async function navigate(action: () => Promise<void>) {
    setChoosing(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("Error: ").at(-1) : undefined;
      setMessage(detail || "The project could not be selected.");
    } finally {
      setChoosing(false);
    }
  }

  async function renameProject(from: Scene, name: string) {
    if (latest.current?.generation !== from.generation || savingGeneration.current !== null) return;
    savingGeneration.current = from.generation;
    setSaving(true);
    setMessage("");
    try {
      await window.easyProto.renameProject(from.generation, from.name, name);
    } catch (error) {
      if (latest.current?.generation === from.generation) {
        const detail = error instanceof Error ? error.message.split("Error: ").at(-1) : undefined;
        setMessage(detail || "The project name could not be saved.");
      }
    } finally {
      if (latest.current?.generation === from.generation) {
        savingGeneration.current = null;
        setSaving(false);
      }
    }
  }

  const busy = !desktop || choosing || saving;
  const page = scene?.pages.find(({ id }) => id === activePageId);
  const otherPages = scene?.pages.filter(({ id }) => id !== activePageId) ?? [];
  function navigatePage(pageId: string) {
    const current = latest.current;
    if (
      !current ||
      choosing ||
      drag.current ||
      savingGeneration.current !== null ||
      pageId === visiblePage.current ||
      !current.pages.some(({ id }) => id === pageId)
    )
      return;
    showPage(current, pageId);
  }
  function closeChat() {
    setOpenChatGeneration(undefined);
    chatTrigger.current?.focus();
  }

  const artboardCount =
    scene?.artboards.filter(({ pageId }) => pageId === activePageId).length ?? 0;
  const choose = (mode: "create" | "open") =>
    void navigate(() => window.easyProto.chooseProject(mode));
  return (
    <main className={scene ? "workspace" : "workspace home-view"}>
      <header>
        {scene ? (
          <button
            type="button"
            className="brand brand-home"
            disabled={busy}
            aria-label="Easy Proto Home"
            onClick={() => void navigate(() => window.easyProto.goHome())}
          >
            <Brand />
          </button>
        ) : (
          <div className="brand">
            <Brand />
          </div>
        )}
        {scene && (
          <>
            <span className="divider" />
            <div className="folder">
              <EditableName
                key={scene.generation}
                kind="project"
                name={scene.name}
                disabled={busy}
                begin={() => {
                  const current = latest.current;
                  return current ? (name) => void renameProject(current, name) : undefined;
                }}
              />
            </div>
            {page && (
              <>
                <span className="divider" />
                <PagePicker
                  key={scene.generation}
                  active={page}
                  pages={scene.pages}
                  disabled={busy}
                  onSwitch={navigatePage}
                  beginRename={(pageId) => {
                    const current = latest.current;
                    return current
                      ? (name) =>
                          saveCommand(
                            { operation: "rename_page", arguments: { pageId, name } },
                            current,
                          )
                      : undefined;
                  }}
                  onCreate={(name) => {
                    const current = latest.current;
                    return current
                      ? saveCommand({ operation: "create_page", arguments: { name } }, current)
                      : Promise.resolve(false);
                  }}
                />
              </>
            )}
          </>
        )}
        {scene && <TokenManager key={scene.generation} scene={scene} disabled={busy} />}
        {scene && (
          <button
            type="button"
            ref={chatTrigger}
            className="chat-toggle"
            aria-controls="chat-dock"
            aria-expanded={chatOpen}
            onClick={() => (chatOpen ? closeChat() : setOpenChatGeneration(scene.generation))}
          >
            <MessageSquare size={15} aria-hidden="true" /> Chat
          </button>
        )}
      </header>
      {desktop?.view === "home" && (
        <div className="home">
          <section aria-labelledby="projects-title">
            <div className="home-heading">
              <h1 id="projects-title">Projects</h1>
              <button
                type="button"
                className="create-project"
                disabled={busy}
                onClick={() => choose("create")}
              >
                <Plus size={15} aria-hidden="true" /> Create project
              </button>
            </div>
            {desktop.projects.length === 0 ? (
              <p>No projects yet</p>
            ) : (
              <ul>
                {desktop.projects.map((project) => (
                  <li key={project.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void navigate(() => window.easyProto.openRecentProject(project.id))
                      }
                    >
                      <Folder size={15} aria-hidden="true" /> <span>{project.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <AgentSettings state={agents} onChange={setAgents} />
        </div>
      )}
      {scene && activePageId && (
        <div className="workspace-body" data-chat-open={chatOpen}>
          <section
            className="canvas"
            aria-label="Artboard canvas"
            onKeyDownCapture={moveWithKeyboard}
          >
            {scene && (
              <ArtboardEditing.Provider value={editing}>
                <ReactFlow
                  key={`${scene.generation}:${activePageId}`}
                  colorMode={colorMode}
                  nodes={nodes}
                  edges={[]}
                  nodeTypes={nodeTypes}
                  fitView={!cameras.current.has(activePageId)}
                  defaultViewport={cameras.current.get(activePageId)}
                  fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
                  onViewportChange={(viewport) => {
                    if (
                      latest.current?.generation === scene.generation &&
                      visiblePage.current === activePageId
                    )
                      cameras.current.set(activePageId, viewport);
                  }}
                  minZoom={0.08}
                  maxZoom={3}
                  nodesDraggable={!saving && !choosing}
                  nodesConnectable={false}
                  elementsSelectable={!saving && !choosing}
                  proOptions={{ hideAttribution: true }}
                  disableKeyboardA11y={false}
                  deleteKeyCode={null}
                  selectionKeyCode={null}
                  multiSelectionKeyCode="Shift"
                  selectionOnDrag
                  selectionMode={SelectionMode.Partial}
                  panOnScroll
                  zoomOnScroll={false}
                  zoomOnPinch
                  panOnDrag={[1, 2]}
                  panActivationKeyCode="Space"
                  onNodeClick={(event, node) => {
                    if (
                      event.shiftKey ||
                      !node.selected ||
                      savingGeneration.current !== null ||
                      (event.target instanceof Element && event.target.closest(".nodrag"))
                    )
                      return;
                    setNodes((current) =>
                      current.map((item) =>
                        item.selected && item.id !== node.id ? { ...item, selected: false } : item,
                      ),
                    );
                  }}
                  onNodesChange={(changes) => {
                    const accepted = changes.filter((change) => {
                      if (change.type === "select" && savingGeneration.current !== null)
                        return false;
                      return change.type !== "position" || Boolean(drag.current);
                    });
                    setNodes((current) => applyNodeChanges(accepted, current));
                  }}
                  onNodeDragStart={(_, _node, dragged) => {
                    if (latest.current && savingGeneration.current === null)
                      drag.current = {
                        ids: new Set(dragged.map(({ id }) => id)),
                        scene: latest.current,
                      };
                  }}
                  onNodeDragStop={(_, _node, dragged) => endDrag(dragged)}
                >
                  <Background gap={24} size={1.25} color="var(--grid)" />
                  <GroupOutline selection={selection} />
                  <FitShortcut />
                </ReactFlow>
              </ArtboardEditing.Provider>
            )}
            {artboardCount === 0 && <p className="empty-page">No artboards on this page</p>}
            {pageMove && (
              <div className="page-move-notice">
                <span role="status">
                  Moved {pageMove.count} {pageMove.count === 1 ? "artboard" : "artboards"} to{" "}
                  <strong>{pageMove.page.name}</strong>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => navigatePage(pageMove.page.id)}
                >
                  Go to page
                </button>
              </div>
            )}
          </section>
          <ChatDock
            key={scene.generation}
            scene={scene}
            open={chatOpen}
            selectedId={selection.length === 1 ? selection[0].id : undefined}
            busy={busy}
            onClose={closeChat}
            profiles={agents?.profiles ?? []}
            onManage={() => {
              focusAgents.current = true;
              void navigate(() => window.easyProto.goHome());
            }}
            onUndo={() => {
              const current = latest.current;
              return current &&
                current.generation === scene.generation &&
                current.revision === scene.revision
                ? saveCommand({ operation: "undo", arguments: {} }, current)
                : Promise.resolve(false);
            }}
          />
        </div>
      )}
      <footer className="workspace-footer">
        <div className="footer-start">
          <Settings
            theme={theme}
            changeTheme={setTheme}
            busy={busy}
            choose={choose}
            goHome={scene ? () => void navigate(() => window.easyProto.goHome()) : undefined}
          />
          {scene && (
            <span>
              {artboardCount} {artboardCount === 1 ? "artboard" : "artboards"}
            </span>
          )}
        </div>
        {scene && (
          <div className="canvas-actions">
            <span title="Shift+0 fits the current page">
              {selection.length > 1
                ? `${selection.length} artboards selected`
                : selection.length === 1
                  ? `${selection[0].data.name} · ${selection[0].data.width} × ${selection[0].data.height} · Delete to remove`
                  : "Scroll to pan · Pinch to zoom · Shift+0 to fit"}
            </span>
            {selection.length > 0 && otherPages.length > 0 && (
              <MoveToPage
                pages={otherPages}
                count={selection.length}
                disabled={busy}
                onMove={(pageId) => {
                  const current = latest.current;
                  if (current && !drag.current)
                    void saveCommand(
                      {
                        operation: "move_artboards_to_page",
                        arguments: { pageId, artboardIds: selection.map(({ id }) => id) },
                      },
                      current,
                    );
                }}
              />
            )}
          </div>
        )}
      </footer>
      {message && (
        <div className="error" role="alert">
          {message} <button onClick={() => setMessage("")}>Dismiss</button>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);
