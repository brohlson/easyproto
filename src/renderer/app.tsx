import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  Background, Controls, ReactFlow, applyNodeChanges, useNodesState,
  type Node, type NodeProps,
} from "@xyflow/react";
import type { DesktopBridge, Scene } from "../shared/model";
import "@xyflow/react/dist/style.css";
import "./styles.css";

declare global {
  interface Window { easyProto: DesktopBridge }
}

type Board = Scene["artboards"][number];
type BoardNode = Node<Board, "artboard">;

const ArtboardNode = memo(function ArtboardNode({ data }: NodeProps<BoardNode>) {
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
  const latest = useRef<Scene>(null);
  const drag = useRef<{ id: string; scene: Scene }>(null);

  function reconcile(currentScene: Scene, reset = false) {
    setNodes((currentNodes) => currentScene.artboards.map((board) => {
      const existing = reset ? undefined : currentNodes.find((node) => node.id === board.id);
      const position = drag.current?.id === board.id && existing
        ? existing.position : { x: board.x, y: board.y };
      return {
        ...existing, id: board.id, type: "artboard", data: board,
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

  async function move(artboardId: string, x: number, y: number, from: Scene) {
    if (latest.current?.generation !== from.generation || saving || choosing) return;
    setSaving(true);
    setMessage("");
    try {
      await window.easyProto.moveArtboard(from.generation, {
        projectId: from.projectId, commandId: crypto.randomUUID(), expectedRevision: from.revision,
        operation: "update_artboard", arguments: { artboardId, patch: { x, y } },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("Error: ").at(-1) : undefined;
      if (latest.current?.generation === from.generation) setMessage(detail || "The artboard could not be moved.");
    } finally {
      if (latest.current?.generation === from.generation) {
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
    if (x !== node.data.x || y !== node.data.y) void move(node.id, x, y, gesture.scene);
  }

  function moveWithKeyboard(event: KeyboardEvent) {
    const direction = arrows.get(event.key);
    if (!direction || !(event.target instanceof HTMLElement)) return;
    const nodeId = event.target.closest<HTMLElement>(".react-flow__node")?.dataset.id;
    const current = latest.current;
    const board = current?.artboards.find((item) => item.id === nodeId);
    if (!current || !board || !nodes.some((node) => node.id === nodeId && node.selected)) return;
    event.preventDefault();
    event.stopPropagation();
    if (drag.current || event.repeat) return;
    const step = event.shiftKey ? 20 : 5;
    void move(board.id, board.x + direction.x * step, board.y + direction.y * step, current);
  }

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
          <button disabled={!scene || choosing || saving} onClick={() => void choose("create")}>New Project</button>
          <button disabled={!scene || choosing || saving} onClick={() => void choose("open")}>Open Project</button>
        </div>
      </header>
      <section className="canvas" aria-label="Artboard canvas" onKeyDownCapture={moveWithKeyboard}>
        {scene && (
          <ReactFlow
            key={scene.generation}
            nodes={nodes} edges={[]} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
            minZoom={0.08} maxZoom={3} panOnDrag
            nodesDraggable={!saving && !choosing} nodesConnectable={false} elementsSelectable
            disableKeyboardA11y={false} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
            onNodesChange={(changes) => setNodes((current) => applyNodeChanges(
              changes.filter((change) => change.type !== "position" || Boolean(drag.current)), current,
            ))}
            onNodeDragStart={(_, node) => {
              if (latest.current) drag.current = { id: node.id, scene: latest.current };
            }}
            onNodeDragStop={(_, node) => endDrag(node)}
          >
            <Background gap={24} size={1.25} color="#c7ceca" />
            <Controls position="bottom-right" showInteractive={false} fitViewOptions={{ padding: 0.4, maxZoom: 1 }} />
          </ReactFlow>
        )}
        {message && <div className="error" role="alert">{message} <button onClick={() => setMessage("")}>Dismiss</button></div>}
      </section>
      <footer>
        <span>{scene?.artboards.length ?? 0} {scene?.artboards.length === 1 ? "artboard" : "artboards"}</span>
        <span>{selected ? `${selected.data.name} · ${selected.data.width} × ${selected.data.height}` : "Drag an artboard to arrange it"}</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
