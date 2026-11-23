import { type CSSProperties } from "react";

const frame = "M10 2H31L46 17V38Q46 46 38 46H10Q2 46 2 38V10Q2 2 10 2Z";

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
    <div className="artboard-working-overlay" data-working={working} aria-hidden={!working}>
      <div
        className="artboard-working-indicator"
        style={{ "--activity-scale": scale } as CSSProperties}
        role="status"
      >
        <svg className="edge-runner" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <path className="edge-runner-track" d={frame} stroke="currentColor" strokeWidth="2" />
          <path
            className="edge-runner-highlight"
            d={frame}
            pathLength="100"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            transform="translate(8 8)"
            fill="currentColor"
            fillRule="evenodd"
            d="M7 4h13l8 8v13a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm3 6v4h6v4h-6v4h12v-8l-4-4h-8Z"
          />
        </svg>
        <span>
          Agent working<span className="screen-reader-only">{working ? ` on ${name}` : ""}</span>
        </span>
      </div>
    </div>
  );
}
