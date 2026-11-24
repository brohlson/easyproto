CREATE TABLE hosted_publications (
  request_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  result TEXT
);
