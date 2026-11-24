import styles from "./brand.module.css";

export function Brand() {
  return (
    <span className={styles.brand} data-testid="brand">
      <svg
        className={styles.foldMark}
        data-testid="fold-mark"
        viewBox="0 0 32 32"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M7 4h13l8 8v13a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm3 6v4h6v4h-6v4h12v-8l-4-4h-8Z"
        />
      </svg>
      Easy Proto
    </span>
  );
}
