/** Read-only planning tool, not a migration or activation path.
 * Call once per table, outside the production request/cron entry points.
 * Returns aggregates only; no business rows, credentials, IDs or SQL errors.
 * No CPU claim: even one metadata query must be measured on Workers Free.
 */
import type { Client } from "@libsql/client";
import type { D1Database } from "@cloudflare/workers-types";
import { migrationDefinitions } from "../packages/web/src/api/database/d1/migration-schema";

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export const FREE_D1_PLANNING_LIMITS = Object.freeze({
  rowsReadPerDay: 5_000_000,
  rowsWrittenPerDay: 100_000,
  databaseBytes: 500_000_000,
  accountStorageBytes: 5_000_000_000,
  workerRequestsPerDay: 100_000,
  plannedStepJsonBytes: 64 * 1024,
});
export type TablePreflight = {
  table: string;
  rows: number;
  rawBytes: number;
  largestRawRowBytes: number;
  jsonRowUpperBoundBytes: number;
  destinationRows: number;
  destinationIndexCount: number;
};
export type FreeUsage = {
  rowsReadToday: number;
  rowsWrittenToday: number;
  workerRequestsToday: number;
  accountStorageBytes: number;
  destinationStorageBytes: number;
};
function natural(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "bigint") throw Error("PREFLIGHT_INVALID_COUNT");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw Error("PREFLIGHT_INVALID_COUNT");
  return n;
}
function columnLayoutMatches(
  info: { name: unknown; pk: unknown }[],
  def: (typeof migrationDefinitions)[number],
) {
  const keys = info.filter((r) => Number(r.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk)).map((r) => r.name);
  return info.length === def.columns.length &&
    def.columns.every((c) => info.some((r) => r.name === c)) &&
    JSON.stringify(keys) === JSON.stringify(def.keys);
}

/** A read transaction covers this table only. The set of table results is NOT a snapshot. */
export async function inspectFreeMigrationTable(
  source: Pick<Client, "transaction">,
  destination: D1Database,
  table: string,
  ownerEmails: readonly string[],
): Promise<TablePreflight> {
  const def = migrationDefinitions.find((d) => d.name === table);
  if (!def) throw Error("PREFLIGHT_UNKNOWN_TABLE");
  const owners = [...new Set(ownerEmails.map((s) => s.trim().toLowerCase()))];
  if (!owners.length || owners.length > 10 || owners.some((s) => !s))
    throw Error("PREFLIGHT_OWNERS_REQUIRED");
  const tx = await source.transaction("read").catch(() => { throw Error("PREFLIGHT_QUERY_FAILED"); });
  try {
    const sourceInfo = await tx.execute(`PRAGMA table_info(${quote(def.name)})`);
    if (!columnLayoutMatches(sourceInfo.rows as unknown as { name: unknown; pk: unknown }[], def))
      throw Error("PREFLIGHT_SOURCE_SCHEMA_MISMATCH");
    const bytes = def.columns.map((c) => `coalesce(length(CAST(${quote(c)} AS BLOB)),0)`).join("+");
    const unsupported = def.columns.map((c) => `typeof(${quote(c)}) NOT IN ('null','text','integer','real')`).join(" OR ");
    const size = await tx.execute(`SELECT count(*) n,coalesce(sum(${bytes}),0) bytes,coalesce(max(${bytes}),0) largest,coalesce(sum(CASE WHEN ${unsupported} THEN 1 ELSE 0 END),0) unsupported FROM ${quote(def.name)}`);
    const row = size.rows[0];
    const count = natural(row.n), rawBytes = natural(row.bytes), largest = natural(row.largest);
    if (natural(row.unsupported)) throw Error("PREFLIGHT_UNSUPPORTED_SOURCE_VALUE");
    if (def.name === "user") {
      const invalid = await tx.execute({
        sql: `SELECT count(*) n FROM "user" WHERE lower(trim(email)) NOT IN (${owners.map(() => "?").join(",")}) OR email_verified IS NOT 1`,
        args: owners,
      });
      if (!count || natural(invalid.rows[0].n)) throw Error("PREFLIGHT_OWNER_MISMATCH");
    }
    const [targetInfo, targetCount, targetIndexes] = await destination.batch<{ name: string; pk: number; n: number }>([
      destination.prepare(`PRAGMA table_info(${quote(def.name)})`),
      destination.prepare(`SELECT count(*) n FROM ${quote(def.name)}`),
      destination.prepare(`PRAGMA index_list(${quote(def.name)})`),
    ]);
    if (!columnLayoutMatches(targetInfo.results, def)) throw Error("PREFLIGHT_DESTINATION_SCHEMA_MISMATCH");
    const result = {
      table: def.name, rows: count, rawBytes,
      largestRawRowBytes: largest,
      // A deliberately conservative JSON bound, not a measured payload size.
      // Six bytes cover escaping of any byte; fixed overhead covers nulls and delimiters.
      jsonRowUpperBoundBytes: count ? natural(largest * 6 + def.columns.length * 6 + 2) : 0,
      destinationRows: natural(targetCount.results[0].n),
      destinationIndexCount: natural(targetIndexes.results.length),
    };
    await tx.commit();
    return result;
  } catch (error) {
    try { await tx.rollback(); } catch { /* Do not mask the aggregate-only error below. */ }
    const code = error instanceof Error ? error.message : "";
    const safe = new Set([
      "PREFLIGHT_INVALID_COUNT", "PREFLIGHT_SOURCE_SCHEMA_MISMATCH",
      "PREFLIGHT_UNSUPPORTED_SOURCE_VALUE", "PREFLIGHT_OWNER_MISMATCH",
      "PREFLIGHT_DESTINATION_SCHEMA_MISMATCH",
    ]);
    throw Error(safe.has(code) ? code : "PREFLIGHT_QUERY_FAILED");
  } finally {
    try { tx.close(); } catch { throw Error("PREFLIGHT_QUERY_FAILED"); }
  }
}

/** Planning reserves only, not a bill, a CPU prediction, or a cutover authorization.
 * Assumes indexed keyset traversal, four single-row passes, two audit passes,
 * and eight D1 writes per invocation reserved for indexed progress/attempt records.
 * Actual query meta and account-wide usage must be rechecked during execution.
 */
export function planFreeD1Migration(tables: readonly TablePreflight[], usage?: FreeUsage) {
  if (tables.length !== migrationDefinitions.length || new Set(tables.map((t) => t.table)).size !== tables.length ||
      migrationDefinitions.some((d) => !tables.some((t) => t.table === d.name)))
    throw Error("PREFLIGHT_INCOMPLETE_TABLE_SET");
  for (const t of tables) {
    for (const key of ["rows", "rawBytes", "largestRawRowBytes", "jsonRowUpperBoundBytes", "destinationRows", "destinationIndexCount"] as const) natural(t[key]);
    const def = migrationDefinitions.find((d) => d.name === t.table)!;
    if (t.jsonRowUpperBoundBytes !== (t.rows ? natural(t.largestRawRowBytes * 6 + def.columns.length * 6 + 2) : 0))
      throw Error("PREFLIGHT_INVALID_COUNT");
    if (t.largestRawRowBytes > t.rawBytes || (!t.rows && (t.rawBytes || t.largestRawRowBytes || t.jsonRowUpperBoundBytes)))
      throw Error("PREFLIGHT_INVALID_COUNT");
  }
  const sum = (f: (t: TablePreflight) => number) => natural(tables.reduce((n, t) => n + f(t), 0));
  const rows = sum((t) => t.rows);
  const auditRows = tables.find((t) => t.table === "audit_event")!.rows;
  const steps = natural(4 * rows + 2 * auditRows + tables.length * 8 + 16);
  const reserve = {
    workerRequests: steps,
    d1RowsRead: natural(rows * 10 + steps * 4),
    d1RowsWritten: natural(sum((t) => t.rows * (t.destinationIndexCount + 1)) + steps * 8),
    additionalStorageBytes: natural(sum((t) => t.rawBytes * (t.destinationIndexCount + 2) + t.rows * 4096) + 65536),
  };
  const blockers: string[] = [];
  if (tables.some((t) => t.destinationRows)) blockers.push("DESTINATION_NOT_EMPTY");
  if (tables.some((t) => t.largestRawRowBytes > 1_900_000)) blockers.push("D1_ROW_SIZE_REQUIRES_REDESIGN");
  if (tables.find((t) => t.table === "record")!.rows > 1000 ||
      tables.find((t) => t.table === "session")!.rows > 100) blockers.push("CURRENT_APPLICATION_ROW_LIMIT");
  const largeRowTables = tables.filter((t) => t.jsonRowUpperBoundBytes > FREE_D1_PLANNING_LIMITS.plannedStepJsonBytes).map((t) => t.table);
  if (largeRowTables.length) blockers.push("MEASURE_LARGE_ROWS_OR_DESIGN_FIELD_CHUNKS");
  if (!usage) blockers.push("ACCOUNT_USAGE_NOT_CHECKED");
  else {
    for (const key of ["rowsReadToday", "rowsWrittenToday", "workerRequestsToday", "accountStorageBytes", "destinationStorageBytes"] as const) natural(usage[key]);
    if (Object.keys(usage).length !== 5 || usage.destinationStorageBytes > usage.accountStorageBytes)
      throw Error("PREFLIGHT_INVALID_COUNT");
    if (usage.rowsReadToday + reserve.d1RowsRead > FREE_D1_PLANNING_LIMITS.rowsReadPerDay) blockers.push("DAILY_READ_RESERVE_EXCEEDED");
    if (usage.rowsWrittenToday + reserve.d1RowsWritten > FREE_D1_PLANNING_LIMITS.rowsWrittenPerDay) blockers.push("DAILY_WRITE_RESERVE_EXCEEDED");
    if (usage.workerRequestsToday + reserve.workerRequests > FREE_D1_PLANNING_LIMITS.workerRequestsPerDay) blockers.push("DAILY_REQUEST_RESERVE_EXCEEDED");
    if (usage.accountStorageBytes + reserve.additionalStorageBytes > FREE_D1_PLANNING_LIMITS.accountStorageBytes) blockers.push("ACCOUNT_STORAGE_RESERVE_EXCEEDED");
    if (usage.destinationStorageBytes + reserve.additionalStorageBytes > FREE_D1_PLANNING_LIMITS.databaseBytes) blockers.push("DATABASE_STORAGE_RESERVE_EXCEEDED");
  }
  return {
    proposal: "bounded-resumable-v2" as const, rows, largeRowTables, planningReserve: reserve,
    planningBlockers: blockers, fitsPlanningReserve: blockers.length === 0,
    // Never generate the existing activation receipt or silently select D1.
    cutoverAllowed: false as const, migrationImplemented: false as const,
    stillRequired: ["RESUMABLE_COPY_AND_CHECKPOINTS", "FULL_SCHEMA_AND_EMPTY_CONTROL_TABLES", "SOURCE_WRITE_FREEZE", "SOURCE_AND_TARGET_DIGEST_PASSES",
      "AUDIT_AND_INDEPENDENT_WITNESS", "REAL_FREE_CPU_MEASUREMENT", "APPLICATION_AND_OWNER_VERIFICATION"],
  };
}
