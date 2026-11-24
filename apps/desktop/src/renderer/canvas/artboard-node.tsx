import canvasStyles from "./canvas.module.css";
import { MoveDiagonal2 } from "lucide-react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { useStore, type Node, type NodeProps } from "@xyflow/react";
import type { DesktopArtboardPatch, Scene } from "../../shared/model";
import { artboardSize } from "../../shared/artboard-size";
import { EditableName } from "../shared/editable-name";
import { DevicePresets } from "./device-presets";
import { WorkingOverlay } from "./working-overlay";

type Board = Scene["artboards"][number];
export type BoardNode = Node<Board, "artboard">;
export type ArtboardEditActions = {
  disabled: boolean;
  begin(id: string): ((patch: DesktopArtboardPatch) => Promise<boolean>) | undefined;
  focusCopy(id: string): boolean;
};
export const ArtboardEditing = createContext<ArtboardEditActions | null>(null);

function ArtboardPreview({ board }: { board: Board }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      className={canvasStyles.artboardPreview}
      data-testid="artboard-preview"
      data-loaded={loaded}
      aria-busy={board.agentWorking}
    >
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
    <div
      ref={artboard}
      className={canvasStyles.artboard}
      data-testid="artboard"
      style={draft && { width: draft.width }}
    >
      <div
        className={canvasStyles.artboardMeta}
        data-testid="artboard-meta"
        style={
          {
            "--inverse-zoom": 1 / zoom,
            "--label-width": `${Math.max(172, visible.width * zoom)}px`,
          } as CSSProperties
        }
      >
        <div className={canvasStyles.artboardLabel} data-testid="artboard-label">
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
          className={`${canvasStyles.resizeHandle} nodrag nopan`}
          data-testid="resize-handle"
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

export const nodeTypes = { artboard: ArtboardNode };

export const arrows = new Map([
  ["ArrowUp", { x: 0, y: -1 }],
  ["ArrowDown", { x: 0, y: 1 }],
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
]);
