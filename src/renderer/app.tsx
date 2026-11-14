import {
  createContext, memo, useContext, useEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type PointerEvent,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Background, Controls, ReactFlow, applyNodeChanges, useNodesState, useReactFlow, useStore,
  type Node, type NodeProps,
} from "@xyflow/react";
import { artboardSize } from "../shared/artboard-size";
import type { DesktopBridge, GeometryPatch, Scene } from "../shared/model";
import "@xyflow/react/dist/style.css";
import "./styles.css";

declare global {
  interface Window { easyProto: DesktopBridge }
}

type Board = Scene["artboards"][number];
type Size = Pick<Board, "width" | "height">;
type BoardNode = Node<Board, "artboard">;
const ResizeControl = createContext<{
  disabled: boolean;
  begin(id: string): boolean;
  update(id: string, size: Size): void;
  finish(id: string, size?: Size): void;
} | null>(null);

function resizeFrom(start: Size, dx: number, dy: number): Size {
  const clamp = (size: number) => Math.min(artboardSize.max, Math.max(artboardSize.min, Math.round(size)));
  return { width: clamp(start.width + dx), height: clamp(start.height + dy) };
}

const ArtboardNode = memo(function ArtboardNode({ id, data, selected }: NodeProps<BoardNode>) {
  const resize = useContext(ResizeControl)!;
  const { getZoom } = useReactFlow();
  const zoom = useStore((state) => selected ? state.transform[2] : 1);
  const pointer = useRef<{ pointerId: number; x: number; y: number; zoom: number; size: Size }>(null);

  function pointerSize(event: PointerEvent<HTMLButtonElement>) {
    const start = pointer.current;
    if (!start || start.pointerId !== event.pointerId) return;
    return resizeFrom(start.size, (event.clientX - start.x) / start.zoom, (event.clientY - start.y) / start.zoom);
  }

  function endPointer(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    if (pointer.current?.pointerId !== event.pointerId) return;
    const size = commit ? pointerSize(event) : undefined;
    pointer.current = null;
    resize.finish(id, size);
  }

  return (
    <div className="artboard">
      <div className="artboard-label">
        <span>{data.name}</span>
        <span>{data.width} × {data.height}</span>
      </div>
      <iframe
        title={data.name} src={data.previewUrl} sandbox="" tabIndex={-1}
        width={data.width} height={data.height}
      />
      {selected && (
        <button
          type="button" className="resize-handle nodrag nopan" aria-label={`Resize ${data.name}`}
          title="Drag or use arrow keys to resize" aria-disabled={resize.disabled}
          style={{ "--resize-inverse-zoom": 1 / zoom } as CSSProperties}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0 || !resize.begin(id)) return;
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            pointer.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, zoom: getZoom(), size: data };
          }}
          onPointerMove={(event) => {
            const size = pointerSize(event);
            if (size) resize.update(id, size);
          }}
          onPointerUp={(event) => endPointer(event, true)}
          onPointerCancel={(event) => endPointer(event, false)}
          onLostPointerCapture={(event) => endPointer(event, false)}
          onKeyDown={(event) => {
            const direction = arrows.get(event.key);
            if (!direction) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.repeat || !resize.begin(id)) return;
            const step = event.shiftKey ? 20 : 5;
            resize.finish(id, resizeFrom(data, direction.x * step, direction.y * step));
          }}
        />
      )}
    </div>
  );
});

const nodeTypes = { artboard: ArtboardNode };
const arrows = new Map([
  ["ArrowUp", { x: 0, y: -1 }], ["ArrowDown", { x: 0, y: 1 }],
  ["ArrowLeft", { x: -1, y: 0 }], ["ArrowRight", { x: 1, y: 0 }],
]);

function App() {
  const [scene, setScene] = useState<Scene>();
  const [nodes, setNodes] = useNodesState<BoardNode>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const colorMode = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const [resizing, setResizing] = useState(false);
  const activeResize = useRef<{ id: string; scene: Scene; size: Size }>(null);
  const savingGeneration = useRef<number>(null);
  const latest = useRef<Scene>(null);
  const drag = useRef<{ id: string; scene: Scene }>(null);

  function reconcile(currentScene: Scene, reset = false) {
    const draft = activeResize.current;
    const draggingId = drag.current?.id;
    setNodes((currentNodes) => currentScene.artboards.map((board) => {
      const existing = reset ? undefined : currentNodes.find((node) => node.id === board.id);
      const position = draggingId === board.id && existing
        ? existing.position : { x: board.x, y: board.y };
      const size = draft?.id === board.id ? draft.size : board;
      return {
        ...existing, id: board.id, type: "artboard", data: { ...board, width: size.width, height: size.height },
        width: size.width, height: size.height,
        ariaLabel: board.name, position, selected: existing?.selected,
      };
    }));
  }

  useEffect(() => {
    function receive(next: Scene) {
      const previous = latest.current;
      if (previous && (next.generation < previous.generation ||
        (next.generation === previous.generation && next.revision < previous.revision))) return;
      const reset = next.generation !== previous?.generation;
      if (reset) {
        drag.current = null;
        activeResize.current = null;
        savingGeneration.current = null;
        setResizing(false);
        setSaving(false);
        setMessage("");
      }
      latest.current = next;
      setScene(next);
      reconcile(next, reset);
    }
    const unsubscribe = window.easyProto.onScene(receive);
    window.easyProto.getScene().then(receive).catch(() => setMessage("The project could not be loaded."));
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

  useEffect(() => {
    function cancelResize(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || !activeResize.current || !latest.current) return;
      event.preventDefault();
      event.stopPropagation();
      activeResize.current = null;
      setResizing(false);
      reconcile(latest.current);
    }
    window.addEventListener("keydown", cancelResize, true);
    return () => window.removeEventListener("keydown", cancelResize, true);
  }, []);

  async function arrange(artboardId: string, patch: GeometryPatch, from: Scene) {
    if (latest.current?.generation !== from.generation || savingGeneration.current !== null || choosing) return;
    savingGeneration.current = from.generation;
    setSaving(true);
    setMessage("");
    try {
      await window.easyProto.arrangeArtboard(from.generation, {
        projectId: from.projectId, commandId: crypto.randomUUID(), expectedRevision: from.revision,
        operation: "update_artboard", arguments: { artboardId, patch },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("Error: ").at(-1) : undefined;
      if (latest.current?.generation === from.generation) setMessage(detail || "The artboard layout could not be saved.");
    } finally {
      if (latest.current?.generation === from.generation) {
        savingGeneration.current = null;
        setSaving(false);
        reconcile(latest.current);
      }
    }
  }

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
    if (event.target.closest(".resize-handle")) return;
    const nodeId = event.target.closest<HTMLElement>(".react-flow__node")?.dataset.id;
    const current = latest.current;
    const board = current?.artboards.find((item) => item.id === nodeId);
    if (!current || !board || !nodes.some((node) => node.id === nodeId && node.selected)) return;
    event.preventDefault();
    event.stopPropagation();
    if (drag.current || activeResize.current || event.repeat) return;
    const step = event.shiftKey ? 20 : 5;
    void arrange(board.id, { x: board.x + direction.x * step, y: board.y + direction.y * step }, current);
  }

  const resize = {
    disabled: saving || choosing,
    begin(id: string) {
      const current = latest.current;
      const board = current?.artboards.find((item) => item.id === id);
      if (!current || !board || choosing || savingGeneration.current !== null || drag.current || activeResize.current) return false;
      activeResize.current = { id, scene: current, size: { width: board.width, height: board.height } };
      setResizing(true);
      return true;
    },
    update(id: string, size: Size) {
      if (activeResize.current?.id !== id || !latest.current) return;
      activeResize.current = { ...activeResize.current, size };
      reconcile(latest.current);
    },
    finish(id: string, size?: Size) {
      const gesture = activeResize.current;
      if (gesture?.id !== id || !latest.current) return;
      activeResize.current = null;
      setResizing(false);
      const board = gesture.scene.artboards.find((item) => item.id === id)!;
      if (size && (size.width !== board.width || size.height !== board.height)) {
        setNodes((current) => current.map((node) =>
          node.id === id ? { ...node, ...size, data: { ...node.data, ...size } } : node));
        void arrange(id, size, gesture.scene);
      } else {
        reconcile(latest.current);
      }
    },
  };

  async function choose(mode: "create" | "open") {
    setChoosing(true);
    setMessage("");
    try {
      await window.easyProto.chooseProject(mode);
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("Error: ").at(-1) : undefined;
      setMessage(detail || "The project could not be selected.");
    } finally {
      setChoosing(false);
    }
  }

  const selected = nodes.find((node) => node.selected);
  return (
    <main className="workspace">
      <header>
        <div className="brand"><span className="brand-icon" aria-hidden="true" />Easy Proto</div>
        <span className="divider" />
        <strong className="folder">{scene?.folderName ?? "Opening project…"}</strong>
        <div className="save-status" role="status">
          {choosing ? "Selecting project…" : saving ? "Saving…" : scene ? `Saved · Revision ${scene.revision}` : ""}
        </div>
        <div className="project-actions">
          <button disabled={!scene || choosing || saving || resizing} onClick={() => void choose("create")}>New Project</button>
          <button disabled={!scene || choosing || saving || resizing} onClick={() => void choose("open")}>Open Project</button>
          <select aria-label="Appearance" value={theme} onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === "system" || value === "light" || value === "dark") setTheme(value);
          }}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </header>
      <section className="canvas" aria-label="Artboard canvas" onKeyDownCapture={moveWithKeyboard}>
        {scene && (
          <ResizeControl.Provider value={resize}>
            <ReactFlow
              key={scene.generation}
              colorMode={colorMode}
              nodes={nodes} edges={[]} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
              minZoom={0.08} maxZoom={3} panOnDrag
              nodesDraggable={!saving && !choosing && !resizing} nodesConnectable={false} elementsSelectable
              zoomOnScroll={!resizing} zoomOnPinch={!resizing} zoomOnDoubleClick={!resizing}
              disableKeyboardA11y={false} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
              onNodesChange={(changes) => setNodes((current) => applyNodeChanges(
                changes.filter((change) => change.type !== "position" || Boolean(drag.current)), current,
              ))}
              onNodeDragStart={(_, node) => {
                if (latest.current) drag.current = { id: node.id, scene: latest.current };
              }}
              onNodeDragStop={(_, node) => endDrag(node)}
            >
              <Background gap={24} size={1.25} color="var(--grid)" />
              <Controls position="bottom-right" showInteractive={false} fitViewOptions={{ padding: 0.4, maxZoom: 1 }} />
            </ReactFlow>
          </ResizeControl.Provider>
        )}
        {message && <div className="error" role="alert">{message} <button onClick={() => setMessage("")}>Dismiss</button></div>}
      </section>
      <footer>
        <span>{scene?.artboards.length ?? 0} {scene?.artboards.length === 1 ? "artboard" : "artboards"}</span>
        <span>{selected ? `${selected.data.name} · ${selected.data.width} × ${selected.data.height} · Drag the corner to resize` : "Drag an artboard to arrange it"}</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
