-- Auxiliary assertion table for future D1 atomic mutation plans. No business data.
CREATE TABLE IF NOT EXISTS cockpit_atomic_assertion (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
