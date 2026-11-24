CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  manifest TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS page_previews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  source_revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, page_id)
);
