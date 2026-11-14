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
  applyNodeChanges,
  useNodesState,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type {
  DesktopArtboardCommand,
  DesktopArtboardPatch,
  DesktopBridge,
  DesktopState,
  Scene,
} from "../shared/model";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { DevicePresets } from "./device-presets";
import { EditableName } from "./editable-name";
import { Settings, type Theme } from "./settings";

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
const arrows = new Map([
  ["ArrowUp", { x: 0, y: -1 }],
  ["ArrowDown", { x: 0, y: 1 }],
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
]);

function FitShortcut() {
  const { fitView } = useReactFlow();
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (
        event.code !== "Digit0" ||
        !event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest("input, select, textarea, [contenteditable], [popover]")) ||
        document.querySelector(":popover-open")
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
  const scene = desktop?.view === "project" ? desktop : undefined;
  const [nodes, setNodes] = useNodesState<BoardNode>([]);
  const [message, setMessage] = useState("");
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
  const drag = useRef<{ id: string; scene: Scene }>(null);
  const pendingCopy = useRef<string>(null);
  const clipboard = useRef<{ id: string; ready: Promise<boolean> }>(null);

  function reconcile(currentScene: Scene, reset = false) {
    const draggingId = drag.current?.id;
    const copy = pendingCopy.current;
    const selectCopy = copy && currentScene.artboards.some((board) => board.id === copy);
    setNodes((currentNodes) =>
      currentScene.artboards.map((board) => {
        const existing = reset ? undefined : currentNodes.find((node) => node.id === board.id);
        const position =
          draggingId === board.id && existing ? existing.position : { x: board.x, y: board.y };
        return {
          ...existing,
          id: board.id,
          type: "artboard",
          data: board,
          width: board.width,
          height: board.height,
          ariaLabel: board.name,
          position,
          selected: selectCopy ? board.id === copy : existing?.selected,
        };
      }),
    );
  }

  useEffect(() => {
    function receive(next: DesktopState) {
      if (next.sceneVersion <= receivedVersion.current) return;
      receivedVersion.current = next.sceneVersion;
      const current = next.view === "project" ? next : null;
      const reset = current?.generation !== latest.current?.generation;
      if (reset) {
        drag.current = null;
        pendingCopy.current = null;
        clipboard.current = null;
        savingGeneration.current = null;
        setSaving(false);
        setMessage("");
      }
      latest.current = current;
      setDesktop(next);
      if (current) reconcile(current, reset);
      else setNodes([]);
    }
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

  async function saveArtboard(change: ArtboardChange, from: Scene) {
    if (
      latest.current?.generation !== from.generation ||
      savingGeneration.current !== null ||
      choosing
    )
      return;
    savingGeneration.current = from.generation;
    setSaving(true);
    setMessage("");
    try {
      const commit = await window.easyProto.arrangeArtboard(from.generation, {
        projectId: from.projectId,
        commandId: crypto.randomUUID(),
        expectedRevision: from.revision,
        ...change,
      });
      if (
        (change.operation === "duplicate_artboard" ||
          change.operation === "paste_artboard" ||
          ((change.operation === "undo" || change.operation === "redo") &&
            !from.artboards.some(({ id }) => id === commit.artboard.id))) &&
        latest.current?.generation === from.generation
      )
        pendingCopy.current = commit.artboard.id;
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("Error: ").at(-1) : undefined;
      if (latest.current?.generation === from.generation) {
        setMessage(
          detail?.includes("Refresh the project revision")
            ? "The project was updated while you were editing. Try the change again."
            : detail || "The artboard change could not be saved.",
        );
      }
    } finally {
      if (latest.current?.generation === from.generation) {
        savingGeneration.current = null;
        setSaving(false);
        reconcile(latest.current);
      }
    }
  }

  function arrange(artboardId: string, patch: DesktopArtboardPatch, from: Scene) {
    return saveArtboard({ operation: "update_artboard", arguments: { artboardId, patch } }, from);
  }

  const selected = nodes.find((node) => node.selected);
  function canEditCanvas(target: EventTarget | null) {
    return (
      !choosing &&
      !drag.current &&
      savingGeneration.current === null &&
      !(
        target instanceof Element &&
        target.closest("input, select, textarea, [contenteditable], [popover]")
      ) &&
      !document.querySelector(":popover-open")
    );
  }

  const handleCopy = useEffectEvent((event: ClipboardEvent) => {
    const current = latest.current;
    if (
      !event.clipboardData ||
      !current ||
      !selected ||
      !canEditCanvas(event.target) ||
      window.getSelection()?.toString()
    )
      return;
    const id = crypto.randomUUID();
    event.clipboardData.clearData();
    event.clipboardData.setData(artboardClipboardType, id);
    event.preventDefault();
    const ready = window.easyProto.copyArtboard(current.generation, selected.id, id).then(
      () => true,
      () => {
        if (latest.current?.generation === current.generation)
          setMessage("The artboard could not be copied.");
        return false;
      },
    );
    clipboard.current = { id, ready };
  });

  const handlePaste = useEffectEvent(async (event: ClipboardEvent) => {
    const current = latest.current;
    const copied = clipboard.current;
    if (
      !current ||
      !copied ||
      !canEditCanvas(event.target) ||
      event.clipboardData?.getData(artboardClipboardType) !== copied.id
    )
      return;
    event.preventDefault();
    if (await copied.ready) {
      const latestScene = latest.current;
      if (latestScene?.generation === current.generation)
        void saveArtboard(
          { operation: "paste_artboard", arguments: { clipboardId: copied.id } },
          latestScene,
        );
    }
  });

  const handleShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    const key = event.key.toLowerCase();
    // The macOS Delete key reports Backspace. Forward Delete reports Delete.
    const remove = key === "backspace" || key === "delete";
    const canvasCommand = event.metaKey && (key === "d" || key === "z");
    if (
      !(canvasCommand || (remove && !event.metaKey)) ||
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
    if (key === "z") {
      const redo = event.shiftKey;
      if (redo ? !current.canRedo : !current.canUndo) return;
      event.preventDefault();
      void saveArtboard({ operation: redo ? "redo" : "undo", arguments: {} }, current);
      return;
    }
    if (!selected) return;
    event.preventDefault();
    void saveArtboard(
      {
        operation: remove ? "delete_artboard" : "duplicate_artboard",
        arguments: { artboardId: selected.id },
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

  function endDrag(node: BoardNode) {
    const gesture = drag.current;
    drag.current = null;
    if (gesture?.id !== node.id) return;
    const { x, y } = node.position;
    if (x !== node.data.x || y !== node.data.y) void arrange(node.id, { x, y }, gesture.scene);
  }

  function moveWithKeyboard(event: KeyboardEvent) {
    const direction = arrows.get(event.key);
    if (!direction || !(event.target instanceof HTMLElement)) return;
    if (event.target.closest("button, input")) return;
    const nodeId = event.target.closest<HTMLElement>(".react-flow__node")?.dataset.id;
    const current = latest.current;
    const board = current?.artboards.find((item) => item.id === nodeId);
    if (!current || !board || !nodes.some((node) => node.id === nodeId && node.selected)) return;
    event.preventDefault();
    event.stopPropagation();
    if (drag.current || event.repeat) return;
    const step = event.shiftKey ? 20 : 5;
    void arrange(
      board.id,
      { x: board.x + direction.x * step, y: board.y + direction.y * step },
      current,
    );
  }

  const editing = {
    disabled: saving || choosing,
    focusCopy(id: string) {
      if (pendingCopy.current !== id) return false;
      pendingCopy.current = null;
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
  const choose = (mode: "create" | "open") =>
    void navigate(() => window.easyProto.chooseProject(mode));
  return (
    <main className={scene ? "workspace" : "workspace home-view"}>
      <header>
        <div className="brand">
          <span className="brand-icon" aria-hidden="true" />
          Easy Proto
        </div>
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
          </>
        )}
        <Settings
          theme={theme}
          changeTheme={setTheme}
          busy={busy}
          choose={choose}
          goHome={scene ? () => void navigate(() => window.easyProto.goHome()) : undefined}
        />
      </header>
      {desktop?.view === "home" && (
        <section className="home" aria-labelledby="projects-title">
          <div className="home-heading">
            <h1 id="projects-title">Projects</h1>
            <button
              type="button"
              className="create-project"
              disabled={busy}
              onClick={() => choose("create")}
            >
              Create project
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
                    <span>{project.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {scene && (
        <>
          <section
            className="canvas"
            aria-label="Artboard canvas"
            onKeyDownCapture={moveWithKeyboard}
          >
            {scene && (
              <ArtboardEditing.Provider value={editing}>
                <ReactFlow
                  key={scene.generation}
                  colorMode={colorMode}
                  nodes={nodes}
                  edges={[]}
                  nodeTypes={nodeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
                  minZoom={0.08}
                  maxZoom={3}
                  nodesDraggable={!saving && !choosing}
                  nodesConnectable={false}
                  elementsSelectable
                  proOptions={{ hideAttribution: true }}
                  disableKeyboardA11y={false}
                  deleteKeyCode={null}
                  selectionKeyCode={null}
                  multiSelectionKeyCode={null}
                  onNodesChange={(changes) => {
                    const accepted = changes.filter((change) => {
                      if (change.type === "select" && savingGeneration.current !== null)
                        return false;
                      return change.type !== "position" || Boolean(drag.current);
                    });
                    setNodes((current) => applyNodeChanges(accepted, current));
                  }}
                  onNodeDragStart={(_, node) => {
                    if (latest.current) drag.current = { id: node.id, scene: latest.current };
                  }}
                  onNodeDragStop={(_, node) => endDrag(node)}
                >
                  <Background gap={24} size={1.25} color="var(--grid)" />
                  <FitShortcut />
                </ReactFlow>
              </ArtboardEditing.Provider>
            )}
          </section>
          <footer>
            <span>
              {scene?.artboards.length ?? 0}{" "}
              {scene?.artboards.length === 1 ? "artboard" : "artboards"}
            </span>
            <span title="Shift+0 fits all artboards">
              {selected
                ? `${selected.data.name} · ${selected.data.width} × ${selected.data.height} · Delete to remove`
                : "Drag to arrange · Shift+0 to fit"}
            </span>
          </footer>
        </>
      )}
      {message && (
        <div className="error" role="alert">
          {message} <button onClick={() => setMessage("")}>Dismiss</button>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
