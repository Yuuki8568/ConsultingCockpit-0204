-- Staging only: does not replace the live libSQL schema or enable cutover.
CREATE TABLE IF NOT EXISTS cockpit_migration_run (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('copying','verified','failed')),
  row_count INTEGER NOT NULL,
  digest TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cockpit_migration_owner ON cockpit_migration_run(user_id, created_at);
CREATE TABLE IF NOT EXISTS cockpit_migration_row (
  run_id TEXT NOT NULL REFERENCES cockpit_migration_run(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(run_id, ordinal)
);
