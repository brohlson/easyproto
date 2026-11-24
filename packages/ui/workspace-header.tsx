import type { ReactNode } from "react";
import "./workspace-header.css";

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
    <header className="ep-workspace-header">
      <div className="ep-workspace-brand">{brand}</div>
      {project != null && <div className="ep-workspace-project">{project}</div>}
      {page != null && <div className="ep-workspace-page">{page}</div>}
      {actions != null && <div className="ep-workspace-actions">{actions}</div>}
    </header>
  );
}
