CREATE TABLE hosted_shares (
  id TEXT PRIMARY KEY REFERENCES page_previews(id),
  verifier TEXT,
  epoch INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE hosted_limits (
  scope TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
