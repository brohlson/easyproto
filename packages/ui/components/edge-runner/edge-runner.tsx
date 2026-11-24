import styles from "./edge-runner.module.css";

const frame = "M10 2H31L46 17V38Q46 46 38 46H10Q2 46 2 38V10Q2 2 10 2Z";

export function EdgeRunner({ className, animated }: { className: string; animated: boolean }) {
  return (
    <svg
      className={className}
      data-testid="edge-runner"
      data-animated={animated}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <path className={styles.track} d={frame} stroke="currentColor" strokeWidth="2" />
      <path
        className={styles.highlight}
        data-testid="edge-runner-highlight"
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
  );
}
