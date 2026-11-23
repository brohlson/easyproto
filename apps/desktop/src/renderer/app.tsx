import { Brand } from "@easy-proto/ui";
import { Folder, MoveDiagonal2, Plus } from "lucide-react";
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
  type PointerEvent,
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
  useNodesInitialized,
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
import { DevicePresets } from "./device-presets";
import { EditableName } from "./editable-name";
import { ArtboardMenu, type MenuAnchor } from "./artboard-menu";
import { PagePicker } from "./pages";
import { Settings, type Theme } from "./settings";
import { TokenManager } from "./tokens";
import { ToastProvider, useToast } from "./toast";
import { artboardSize } from "../shared/artboard-size";
import { WorkingOverlay } from "./working-overlay";
import desktopTokens from "./design.tokens.json";
import { WebPreviewDialog } from "./web-preview";

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
  begin(id: string): ((patch: DesktopArtboardPatch) => Promise<boolean>) | undefined;
  focusCopy(id: string): boolean;
} | null>(null);

function ArtboardPreview({ board }: { board: Board }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="artboard-preview" data-loaded={loaded} aria-busy={board.agentWorking}>
      <iframe
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
  const [arbitrary, setArbitrary] = useState(false);
  const [draft, setDraft] = useState<{ width: number; height: number }>();
  const handle = useRef<HTMLButtonElement>(null);
  const gesture = useRef<
    | {
        pointerId: number;
        x: number;
        y: number;
        zoom: number;
        width: number;
        height: number;
        save(patch: DesktopArtboardPatch): Promise<boolean>;
      }
    | undefined
  >(undefined);
  const visible = draft ? { ...data, ...draft } : data;

  function pointerSize(event: PointerEvent<HTMLButtonElement>) {
    const start = gesture.current;
    if (start?.pointerId !== event.pointerId) return;
    return {
      width: resizeDimension(start.width + (event.clientX - start.x) / start.zoom),
      height: resizeDimension(start.height + (event.clientY - start.y) / start.zoom),
    };
  }

  useEffect(() => {
    if (arbitrary) handle.current?.focus({ preventScroll: true });
  }, [arbitrary]);

  useLayoutEffect(() => {
    if (selected && editing.focusCopy(id))
      artboard.current?.closest<HTMLElement>(".react-flow__node")?.focus({ preventScroll: true });
  }, [selected]);

  return (
    <div ref={artboard} className="artboard" style={draft && { width: draft.width }}>
      <div
        className="artboard-meta"
        style={
          {
            "--inverse-zoom": 1 / zoom,
            "--label-width": `${Math.max(172, visible.width * zoom)}px`,
          } as CSSProperties
        }
      >
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
            width={visible.width}
            height={visible.height}
            disabled={editing.disabled}
            begin={() => editing.begin(id)}
            arbitrary={arbitrary}
            onArbitraryChange={setArbitrary}
          />
        </div>
      </div>
      <ArtboardPreview key={data.previewUrl} board={visible} />
      <WorkingOverlay
        working={data.agentWorking}
        name={data.name}
        scale={Math.min(1 / zoom, visible.width / 144, visible.height / 112)}
      />
      {arbitrary && (
        <button
          ref={handle}
          type="button"
          className="resize-handle nodrag nopan"
          style={{ transform: `translate(50%, 50%) scale(${1 / zoom})` }}
          aria-disabled={editing.disabled}
          aria-label={`Resize artboard ${data.name}`}
          title="Drag to resize. Arrow keys resize by 5 px, Shift by 20 px."
          onPointerDown={(event) => {
            if (event.button !== 0 || gesture.current || editing.disabled) return;
            const save = editing.begin(id);
            if (!save) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            gesture.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              zoom,
              width: data.width,
              height: data.height,
              save,
            };
          }}
          onPointerMove={(event) => {
            const size = pointerSize(event);
            if (size) setDraft(size);
          }}
          onPointerUp={async (event) => {
            const size = pointerSize(event);
            if (!size) return;
            const start = gesture.current!;
            gesture.current = undefined;
            if (size.width !== start.width || size.height !== start.height) {
              setDraft(size);
              await start.save(size);
            }
            setDraft(undefined);
          }}
          onLostPointerCapture={(event) => {
            if (gesture.current?.pointerId !== event.pointerId) return;
            gesture.current = undefined;
            setDraft(undefined);
          }}
          onKeyDown={(event) => {
            const direction = arrows.get(event.key);
            if (!direction || event.metaKey || event.ctrlKey || event.altKey) return;
            event.preventDefault();
            event.stopPropagation();
            if (editing.disabled || gesture.current) return;
            const save = editing.begin(id);
            if (!save) return;
            const step = event.shiftKey ? 20 : 5;
            const width = resizeDimension(data.width + direction.x * step);
            const height = resizeDimension(data.height + direction.y * step);
            if (width !== data.width || height !== data.height) void save({ width, height });
          }}
        >
          <MoveDiagonal2 size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
});

function resizeDimension(value: number) {
  return Math.max(artboardSize.min, Math.min(artboardSize.max, Math.round(value)));
}

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

function FollowAgent({ request }: { request?: Scene["agentFocus"] }) {
  const { fitView } = useReactFlow();
  const initialized = useNodesInitialized();
  const applied = useRef<number>(undefined);
  useEffect(() => {
    if (!request || !initialized || applied.current === request.sequence) return;
    applied.current = request.sequence;
    void fitView({
      nodes: request.artboardIds.map((id) => ({ id })),
      padding: 0.25,
      minZoom: 0.08,
      maxZoom: 1,
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : desktopTokens.desktop.motion["working-focus"].$value.value,
    });
  }, [request, initialized, fitView]);
  return null;
}

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
          event.target.closest("input, select, textarea, [contenteditable], [popover]")) ||
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
  const { notify, dismiss } = useToast();
  const [desktop, setDesktop] = useState<DesktopState>();
  const scene = desktop?.view === "project" ? desktop : undefined;
  const [nodes, setNodes] = useNodesState<BoardNode>([]);
  const [message, setMessage] = useState("");
  const [activePageId, setActivePageId] = useState<string>();
  const [agentFocus, setAgentFocus] = useState<Scene["agentFocus"]>();
  const followedActivity = useRef<number>(undefined);
  const [pageMove, setPageMove] = useState<{ page: Page; count: number }>();
  const [menu, setMenu] = useState<{
    key: string;
    anchor: MenuAnchor;
    ids: string[];
    move: boolean;
    scene: Scene;
  }>();
  const [saving, setSaving] = useState(false);
  const [exportingPage, setExportingPage] = useState<{ scene: Scene; pageId: string }>();
  const [choosing, setChoosing] = useState(false);
  const choosingProject = useRef(false);
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
    setAgentFocus(undefined);
    setMenu(undefined);
    visiblePage.current = pageId;
    window.easyProto.reportVisiblePage(current.generation, pageId);
    pendingSelection.current = null;
    setActivePageId(pageId);
    setPageMove(undefined);
    reconcile(current, true);
  }

  function receive(next: DesktopState) {
    if (next.sceneVersion <= receivedVersion.current) return;
    receivedVersion.current = next.sceneVersion;
    const current = next.view === "project" ? next : null;
    if (
      current?.generation !== latest.current?.generation ||
      current?.revision !== latest.current?.revision
    )
      setMenu(undefined);
    const reset = current?.generation !== latest.current?.generation;
    if (reset) {
      setExportingPage(undefined);
      followedActivity.current = undefined;
      setAgentFocus(undefined);
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
      const focus = current.agentFocus;
      if (focus && followedActivity.current !== focus.sequence) {
        followedActivity.current = focus.sequence;
        const targets = current.artboards.filter(
          (board) => focus.artboardIds.includes(board.id) && board.agentWorking,
        );
        // A user's current gesture or editor takes precedence over camera following.
        const interacting =
          drag.current ||
          savingGeneration.current !== null ||
          choosingProject.current ||
          document.activeElement?.closest("input, select, textarea, [contenteditable]") ||
          document.querySelector(":popover-open, dialog[open]");
        if (targets.length && !interacting) {
          const pageId = targets[0].pageId;
          if (visiblePage.current !== pageId) showPage(current, pageId);
          else setMenu(undefined);
          setAgentFocus({
            sequence: focus.sequence,
            artboardIds: targets.filter((board) => board.pageId === pageId).map(({ id }) => id),
          });
        }
      }
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
      if (
        (change.operation === "create_page" ||
          (change.operation === "undo" &&
            "page" in commit &&
            !from.pages.some(({ id }) => id === commit.page.id))) &&
        "page" in commit
      ) {
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
  function openBoardMenu(target: Element, x: number, y: number) {
    if (
      !scene ||
      busy ||
      drag.current ||
      savingGeneration.current !== null ||
      target.closest("input, textarea, [contenteditable], [popover]")
    )
      return false;
    const node = target.closest<HTMLElement>(".react-flow__node");
    const id = node?.dataset.id;
    const owner = node ?? target.closest<HTMLElement>(".react-flow__nodesselection-rect");
    if (!owner) return false;
    let ids = selection.map(({ id }) => id);
    if (id && !ids.includes(id)) {
      ids = [id];
      setNodes((current) => current.map((item) => ({ ...item, selected: item.id === id })));
    }
    if (!ids.length) return false;
    setMenu({ key: crypto.randomUUID(), anchor: { x, y, owner }, ids, move: false, scene });
    return true;
  }
  function canEditCanvas(target: EventTarget | null) {
    return (
      !choosing &&
      !drag.current &&
      savingGeneration.current === null &&
      !(
        target instanceof Element &&
        target.closest("input, select, textarea, [contenteditable], [popover]")
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
      return (patch: DesktopArtboardPatch) => arrange(id, patch, current);
    },
  };

  async function navigate(action: () => Promise<void>) {
    choosingProject.current = true;
    setChoosing(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("Error: ").at(-1) : undefined;
      setMessage(detail || "The project could not be selected.");
    } finally {
      choosingProject.current = false;
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

  const artboardCount =
    scene?.artboards.filter(({ pageId }) => pageId === activePageId).length ?? 0;
  const choose = (mode: "create" | "open") =>
    void navigate(() => window.easyProto.chooseProject(mode));

  function saveProjectCopy() {
    const current = latest.current;
    if (!current || busy || drag.current) return;
    dismiss("workspace");
    void navigate(async () => {
      if (await window.easyProto.saveProjectCopy(current.generation)) notify("Project copy saved");
    });
  }
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
                  artboards={scene.artboards}
                  disabled={busy}
                  onSwitch={navigatePage}
                  beginDelete={(pageId) => {
                    const current = latest.current;
                    return current
                      ? () =>
                          saveCommand({ operation: "delete_page", arguments: { pageId } }, current)
                      : undefined;
                  }}
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
        </div>
      )}
      {scene && activePageId && (
        <section
          className="canvas"
          aria-label="Artboard canvas"
          onContextMenuCapture={(event) => {
            if (
              event.target instanceof Element &&
              openBoardMenu(event.target, event.clientX, event.clientY)
            ) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onKeyDownCapture={(event) => {
            if (
              event.target instanceof Element &&
              (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
            ) {
              const rect = event.target.getBoundingClientRect();
              if (openBoardMenu(event.target, rect.left + 12, rect.top + 12)) {
                event.preventDefault();
                event.stopPropagation();
              }
            } else moveWithKeyboard(event);
          }}
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
                    if (change.type === "select" && savingGeneration.current !== null) return false;
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
                <FollowAgent request={agentFocus} />
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
              <button type="button" disabled={busy} onClick={() => navigatePage(pageMove.page.id)}>
                Go to page
              </button>
            </div>
          )}
        </section>
      )}
      <footer className="workspace-footer">
        <div className="footer-start">
          <Settings
            theme={theme}
            changeTheme={setTheme}
            busy={busy}
            choose={choose}
            saveCopy={scene ? saveProjectCopy : undefined}
            exportPage={
              scene && activePageId
                ? () => setExportingPage({ scene, pageId: activePageId })
                : undefined
            }
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
                  ? `${selection[0].data.name} · ${selection[0].data.width} × ${selection[0].data.height}`
                  : "Scroll to pan · Pinch to zoom · Shift+0 to fit"}
            </span>
            {selection.length > 1 && (
              <>
                <button
                  type="button"
                  className="page-trigger selection-action"
                  aria-haspopup="menu"
                  aria-expanded={Boolean(menu?.move)}
                  disabled={busy || !otherPages.length}
                  onClick={(event) => {
                    if (drag.current) return;
                    const owner = event.currentTarget;
                    const rect = owner.getBoundingClientRect();
                    setMenu({
                      key: crypto.randomUUID(),
                      anchor: { x: rect.left, y: rect.top, owner },
                      ids: selection.map(({ id }) => id),
                      move: true,
                      scene,
                    });
                  }}
                >
                  Move…
                </button>
                <button
                  type="button"
                  className="page-trigger selection-action"
                  disabled={busy}
                  onClick={() => {
                    if (drag.current) return;
                    void saveCommand(
                      {
                        operation: "delete_artboards",
                        arguments: { artboardIds: selection.map(({ id }) => id) },
                      },
                      scene,
                    );
                  }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </footer>
      {exportingPage && (
        <WebPreviewDialog
          key={`${exportingPage.scene.generation}:${exportingPage.pageId}`}
          scene={exportingPage.scene}
          pageId={exportingPage.pageId}
          close={() => setExportingPage(undefined)}
        />
      )}
      {menu && (
        <ArtboardMenu
          key={menu.key}
          anchor={menu.anchor}
          startWithPages={menu.move}
          pages={otherPages}
          count={menu.ids.length}
          disabled={busy}
          dismiss={() => setMenu(undefined)}
          rename={() =>
            menu.anchor.owner.querySelector<HTMLButtonElement>(".editable-name")?.click()
          }
          remove={() =>
            void saveCommand(
              { operation: "delete_artboards", arguments: { artboardIds: menu.ids } },
              menu.scene,
            )
          }
          move={(pageId) =>
            void saveCommand(
              { operation: "move_artboards_to_page", arguments: { artboardIds: menu.ids, pageId } },
              menu.scene,
            )
          }
        />
      )}
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
