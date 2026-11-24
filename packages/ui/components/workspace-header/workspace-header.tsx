import type { ReactNode } from "react";
import styles from "./workspace-header.module.css";

export function WorkspaceLabel({ children }: { children: ReactNode }) {
  return <span className={styles.label}>{children}</span>;
}

export function WorkspaceHeader({
  brand,
  project,
  page,
  actions,
}: {
  brand: ReactNode;
  project?: ReactNode;
  page?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.header} data-testid="workspace-header">
      <div className={styles.brand}>{brand}</div>
      {project != null && (
        <div className={styles.project} data-testid="workspace-project">
          {project}
        </div>
      )}
      {page != null && (
        <div className={styles.page} data-testid="workspace-page">
          {page}
        </div>
      )}
      {actions != null && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
