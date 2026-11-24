import { EdgeRunner } from "@easy-proto/ui";
import controls from "../shared/controls.module.css";
import canvasStyles from "./canvas.module.css";
import { type CSSProperties } from "react";

export function WorkingOverlay({
  working,
  name,
  scale,
}: {
  working: boolean;
  name: string;
  scale: number;
}) {
  return (
    <div
      className={canvasStyles.artboardWorkingOverlay}
      data-testid="artboard-working-overlay"
      data-working={working}
      aria-hidden={!working}
    >
      <div
        className={canvasStyles.artboardWorkingIndicator}
        style={{ "--activity-scale": scale } as CSSProperties}
        role="status"
      >
        <EdgeRunner className={canvasStyles.edgeRunner} animated={working} />
        <span>
          Agent working
          <span className={controls.screenReaderOnly}>{working ? ` on ${name}` : ""}</span>
        </span>
      </div>
    </div>
  );
}
