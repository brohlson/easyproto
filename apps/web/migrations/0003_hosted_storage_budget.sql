CREATE TABLE hosted_storage_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes >= 0)
);
