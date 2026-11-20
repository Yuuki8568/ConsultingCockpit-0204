import type { D1DatabaseSession } from "@cloudflare/workers-types";

// Conservative admission allowances for one bounded operation, not measured
// Cloudflare charges. Never refund failed or uncertain attempts. Retain all
// lifetime storage allowances to cover data not yet reflected in telemetry.
export const STEP_RESERVE = Object.freeze({ reads: 16_384, writes: 128, requests: 4, storageBytes: 131_072 });
// The database clock is authoritative for both admission and the mutation fence.
export const DB_NOW_MS = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
export const UTC_DAY = `CAST(${DB_NOW_MS} / 86400000 AS INTEGER)`;
export const EXECUTION_CONTROL_SCHEMA = `CREATE TABLE cockpit_execution_control (
 slot INTEGER PRIMARY KEY CHECK(slot=1), run_id TEXT NOT NULL,
 expires_at_ms INTEGER NOT NULL, max_attempts INTEGER NOT NULL CHECK(max_attempts>0),
 daily_requests INTEGER NOT NULL CHECK(daily_requests>0), daily_reads INTEGER NOT NULL CHECK(daily_reads>0),
 daily_writes INTEGER NOT NULL CHECK(daily_writes>0), attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND max_attempts),
 utc_day INTEGER NOT NULL, reserved_requests INTEGER NOT NULL DEFAULT 0 CHECK(reserved_requests BETWEEN 0 AND daily_requests),
 reserved_reads INTEGER NOT NULL DEFAULT 0 CHECK(reserved_reads BETWEEN 0 AND daily_reads),
 reserved_writes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_writes BETWEEN 0 AND daily_writes),
 observed_at_ms INTEGER NOT NULL DEFAULT 0, observed_requests INTEGER NOT NULL DEFAULT 0,
 observed_reads INTEGER NOT NULL DEFAULT 0, observed_writes INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until_ms INTEGER NOT NULL DEFAULT 0,
 CHECK((lease_token IS NULL AND lease_until_ms=0) OR (lease_token IS NOT NULL AND lease_until_ms>0))
) STRICT`;

export type ExecutionFence = Readonly<{ runId: string; token: string }>;

/** Lease check in the same rollback-checked batch as the business write.
 * Installing a control table also disables unfenced legacy calls on this target.
 * A lost or superseded lease cannot authorize mutations by an earlier owner.
 */
export function mutationFence(db: D1DatabaseSession, fence?: ExecutionFence) {
  if (!fence) {
    const statement = db.prepare(`INSERT INTO cockpit_atomic_assertion(id,ok)
      SELECT ?,0 WHERE EXISTS(SELECT 1 FROM main.sqlite_schema WHERE name='cockpit_execution_control' COLLATE NOCASE)`)
      .bind(crypto.randomUUID());
    return { statement, expectedChanges: 0 };
  }
  const statement = db.prepare(`UPDATE cockpit_execution_control SET lease_until_ms=lease_until_ms
    WHERE slot=1 AND run_id=? AND lease_token=? AND lease_until_ms>${DB_NOW_MS}
    AND expires_at_ms>${DB_NOW_MS} AND utc_day=${UTC_DAY}`).bind(fence.runId, fence.token);
  return { statement, expectedChanges: 1 };
}
