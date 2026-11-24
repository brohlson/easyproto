import canvasStyles from "./canvas.module.css";
import { useEffect, useLayoutEffect, useRef } from "react";
import {
  Background,
  ReactFlow,
  SelectionMode,
  ViewportPortal,
  getNodesBounds,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type ReactFlowProps,
} from "@xyflow/react";
import type { Scene } from "../../shared/model";
import desktopTokens from "../design.tokens.json";
import {
  ArtboardEditing,
  nodeTypes,
  type ArtboardEditActions,
  type BoardNode,
} from "./artboard-node";

function GroupOutline({ selection }: { selection: BoardNode[] }) {
  const selecting = useStore((state) => state.userSelectionActive);
  if (selecting || selection.length < 2) return null;
  const { x, y, width, height } = getNodesBounds(selection);
  return (
    <ViewportPortal>
      <div
        className={canvasStyles.artboardGroupOutline}
        data-testid="artboard-group-outline"
        aria-hidden="true"
        style={{ left: x, top: y, width, height }}
      />
    </ViewportPortal>
  );
}

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

export function ArtboardFlow({
  flowKey,
  editing,
  selection,
  agentFocus,
  ...flow
}: ReactFlowProps<BoardNode> & {
  flowKey: string;
  editing: ArtboardEditActions;
  selection: BoardNode[];
  agentFocus?: Scene["agentFocus"];
}) {
  return (
    <ArtboardEditing.Provider value={editing}>
      <ReactFlow
        key={flowKey}
        {...flow}
        edges={[]}
        nodeTypes={nodeTypes}
        fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
        minZoom={0.08}
        maxZoom={3}
        nodesConnectable={false}
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
      >
        <Background gap={24} size={1.25} color="var(--grid)" />
        <GroupOutline selection={selection} />
        <FitShortcut />
        <FollowAgent request={agentFocus} />
      </ReactFlow>
    </ArtboardEditing.Provider>
  );
}
