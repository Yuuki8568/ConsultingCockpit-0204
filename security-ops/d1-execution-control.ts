/** Internal operation on a detached target. A future operator must provide fresh
 * account-wide measurements and verify the source freeze. No HTTP or cron entry.
 */
import type { Client } from "@libsql/client";
import type { D1Database, D1DatabaseSession } from "@cloudflare/workers-types";
import type { WitnessService } from "../packages/web/src/api/database/d1/witness";
import { initializeBoundedCopy, copyBoundedStep, type CopyScope } from "./d1-copy-checkpoint";
import { initializeCopyVerification, verifyCopyStep, finalizeCopyReceipt } from "./d1-copy-verification";
import { FREE_D1_PLANNING_LIMITS as FREE, type FreeUsage } from "./d1-free-preflight";
import { inspectMigrationInventory } from "./d1-inventory";
import { DB_NOW_MS, UTC_DAY, EXECUTION_CONTROL_SCHEMA, STEP_RESERVE } from "./d1-execution-schema";
export { EXECUTION_CONTROL_SCHEMA, STEP_RESERVE } from "./d1-execution-schema";

const MAX_WINDOW_MS = 7 * 86_400_000;
const MAX_ATTEMPTS = 12_000;
const MAX_SAMPLE_AGE_MS = 60_000;
const LEASE_MS = 30_000;

export type ExecutionPolicy = Readonly<{
  expiresAtMs: number; maxAttempts: number;
  dailyReads: number; dailyWrites: number; dailyRequests: number;
}>;
type Usage = Readonly<FreeUsage & { observedAtMs: number }>;
type Operation = "initialize-copy" | "copy" | "initialize-verification" | "verify" | "finalize";
type Source = Pick<Client, "transaction">;
type Step = Readonly<{
  source: Source; target: D1Database; runId: string; scope: CopyScope;
  operation: Operation; expectedRevision: number; witness?: WitnessService; usage: Usage;
}>;

function validInteger(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function validateRun(runId: string) {
  if (typeof runId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(runId)) throw Error("EXECUTION_INVALID_RUN");
}
function validatePolicy(p: ExecutionPolicy) {
  if (!p || !validInteger(p.expiresAtMs, 1) || !validInteger(p.maxAttempts, 1, MAX_ATTEMPTS) ||
      !validInteger(p.dailyRequests, 1, FREE.workerRequestsPerDay) || !validInteger(p.dailyReads, 1, FREE.rowsReadPerDay) ||
      !validInteger(p.dailyWrites, 1, FREE.rowsWrittenPerDay)) throw Error("EXECUTION_INVALID_POLICY");
}
function validateUsage(u: Usage) {
  if (!u || !validInteger(u.observedAtMs, 1) || !validInteger(u.rowsReadToday, 0, FREE.rowsReadPerDay) ||
      !validInteger(u.rowsWrittenToday, 0, FREE.rowsWrittenPerDay) || !validInteger(u.workerRequestsToday, 0, FREE.workerRequestsPerDay) ||
      !validInteger(u.accountStorageBytes, 0, FREE.accountStorageBytes) ||
      !validInteger(u.destinationStorageBytes, 0, Math.min(FREE.databaseBytes, u.accountStorageBytes))) throw Error("EXECUTION_INVALID_USAGE");
}

// The table has an INTEGER PRIMARY KEY and needs no secondary indexes/triggers.
// Compare inside SQLite without returning DDL and bound schema metadata output.
async function checkLedger(db: D1DatabaseSession) {
  const row = await db.prepare(`SELECT EXISTS(SELECT 1 FROM main.sqlite_schema WHERE type='table'
    AND name='cockpit_execution_control' AND sql=?) AND NOT EXISTS(SELECT 1 FROM main.sqlite_schema
    WHERE tbl_name='cockpit_execution_control' COLLATE NOCASE AND type<>'table') AS valid`)
    .bind(EXECUTION_CONTROL_SCHEMA).first<{ valid: number }>();
  if (row?.valid !== 1) throw Error("EXECUTION_SCHEMA_MISMATCH");
}
function cleanError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  // Helpers below already redact their own errors. Do not pass DB errors through.
  if (["EXECUTION_SCHEMA_MISMATCH", "EXECUTION_DENIED", "EXECUTION_NOT_STARTED"].includes(message)) return Error(message);
  return Error("EXECUTION_UNCONFIRMED");
}
export async function initializeExecutionControl(target: D1Database, runId: string, policy: ExecutionPolicy, source: Source) {
  validateRun(runId);
  const p = { ...policy };
  validatePolicy(p);
  const db = target.withSession("first-primary");
  try {
    await checkLedger(db);
    const eligible = await db.prepare(`SELECT 1 AS ok WHERE ? > ${DB_NOW_MS} AND ? <= ${DB_NOW_MS}+?
      AND NOT EXISTS (SELECT 1 FROM cockpit_execution_control)`)
      .bind(p.expiresAtMs, p.expiresAtMs, MAX_WINDOW_MS).first();
    if (!eligible) throw Error("EXECUTION_DENIED");
  } catch (error) { throw cleanError(error); }
  await inspectMigrationInventory(source, target);
  try {
    const result = await db.prepare(`INSERT INTO cockpit_execution_control
      (slot,run_id,expires_at_ms,max_attempts,daily_requests,daily_reads,daily_writes,utc_day)
      SELECT 1,?,?,?,?,?,?,${UTC_DAY} WHERE ? > ${DB_NOW_MS} AND ? <= ${DB_NOW_MS}+?
      AND NOT EXISTS (SELECT 1 FROM cockpit_execution_control)`).bind(runId, p.expiresAtMs, p.maxAttempts,
      p.dailyRequests, p.dailyReads, p.dailyWrites, p.expiresAtMs, p.expiresAtMs, MAX_WINDOW_MS).run();
    if (result.meta.changes !== 1) throw Error("EXECUTION_DENIED");
  } catch (error) { throw cleanError(error); }
  return getExecutionControlStatus(target, runId);
}

export async function getExecutionControlStatus(target: D1Database, runId: string) {
  validateRun(runId);
  const db = target.withSession("first-primary");
  try {
    await checkLedger(db);
    const r = await db.prepare(`SELECT attempts,utc_day,reserved_requests,reserved_reads,reserved_writes,
      lease_token IS NOT NULL AND lease_until_ms>${DB_NOW_MS} AND expires_at_ms>${DB_NOW_MS} AND utc_day=${UTC_DAY} AS leased,
      expires_at_ms FROM cockpit_execution_control WHERE slot=1 AND run_id=?`).bind(runId).first<Record<string, number>>();
    if (!r) throw Error("EXECUTION_NOT_STARTED");
    return {
      attempts: r.attempts, leased: r.leased === 1, day: r.utc_day,
      reservedReads: r.reserved_reads, reservedWrites: r.reserved_writes,
      reservedRequests: r.reserved_requests, expiresAtMs: r.expires_at_ms, cutoverAllowed: false as const,
    };
  } catch (error) { throw cleanError(error); }
}

// Expressions refer to the pre-update ledger. At the UTC boundary only the
// daily counters reset. Samples must belong to the DB's current day. A newer
// but lower reported usage never releases account headroom on the same day.
function today(column: string) { return `(CASE WHEN utc_day=${UTC_DAY} THEN ${column} ELSE 0 END)`; }
const reads = `${today('reserved_reads')}+${STEP_RESERVE.reads}`;
const writes = `${today('reserved_writes')}+${STEP_RESERVE.writes}`;
const requests = `${today('reserved_requests')}+${STEP_RESERVE.requests}`;
const observedReads = `max(${today('observed_reads')},?3)`;
const observedWrites = `max(${today('observed_writes')},?4)`;
const observedRequests = `max(${today('observed_requests')},?5)`;
const reserveSql = `UPDATE cockpit_execution_control SET attempts=attempts+1, utc_day=${UTC_DAY},
  reserved_reads=${reads}, reserved_writes=${writes}, reserved_requests=${requests},
  observed_reads=${observedReads}, observed_writes=${observedWrites}, observed_requests=${observedRequests}, observed_at_ms=?2,
  lease_token=?8,lease_until_ms=min(${DB_NOW_MS}+${LEASE_MS},expires_at_ms,(${UTC_DAY}+1)*86400000)
  WHERE slot=1 AND run_id=?1 AND utc_day<=${UTC_DAY} AND expires_at_ms>${DB_NOW_MS}
    AND (lease_token IS NULL OR lease_until_ms<=${DB_NOW_MS}) AND attempts<max_attempts
    AND ?2 BETWEEN ${DB_NOW_MS}-${MAX_SAMPLE_AGE_MS} AND ${DB_NOW_MS}
    AND CAST(?2/86400000 AS INTEGER)=${UTC_DAY} AND ?2>=observed_at_ms
    AND ${reads}<=daily_reads AND ${writes}<=daily_writes AND ${requests}<=daily_requests
    AND ${reads}+${observedReads}<=${FREE.rowsReadPerDay} AND ${writes}+${observedWrites}<=${FREE.rowsWrittenPerDay}
    AND ${requests}+${observedRequests}<=${FREE.workerRequestsPerDay}
    AND (attempts+1)*${STEP_RESERVE.storageBytes}+?6<=${FREE.accountStorageBytes}
    AND (attempts+1)*${STEP_RESERVE.storageBytes}+?7<=${FREE.databaseBytes}`;

export async function runControlledMigrationStep(input: Step) {
  const { source, target, runId, expectedRevision, operation, witness } = input;
  validateRun(runId);
  if (!["initialize-copy", "copy", "initialize-verification", "verify", "finalize"].includes(operation) || !validInteger(expectedRevision, 0) ||
      (operation.startsWith("initialize-") && expectedRevision !== 0)) throw Error("EXECUTION_INVALID_OPERATION");
  if (input.scope?.maintenanceConfirmed !== true || input.scope.destinationDetached !== true || !Array.isArray(input.scope.ownerEmails))
    throw Error("COPY_SCOPE_REQUIRED");
  const scope = { ...input.scope, ownerEmails: [...input.scope.ownerEmails] };
  const u = { ...input.usage };
  validateUsage(u);
  const db = target.withSession("first-primary"), fence = { runId, token: crypto.randomUUID() };
  try {
    await checkLedger(db);
    const claim = await db.prepare(reserveSql).bind(runId, u.observedAtMs, u.rowsReadToday, u.rowsWrittenToday,
      u.workerRequestsToday, u.accountStorageBytes, u.destinationStorageBytes, fence.token).run();
    if (claim.meta.changes !== 1) throw Error("EXECUTION_DENIED");
  } catch (error) { throw cleanError(error); }

  // Exactly one admission per operation. If a call fails or its response is
  // lost, leave the lease and reservation intact. Operator rereads progress.
  // A new owner may acquire only after expiry; the old token then cannot commit.
  let result;
  switch (operation) {
    case "initialize-copy": result = await initializeBoundedCopy(target, runId, scope, fence); break;
    case "copy": result = await copyBoundedStep(source, target, runId, expectedRevision, scope, fence); break;
    case "initialize-verification": result = await initializeCopyVerification(target, runId, scope, fence); break;
    case "verify": result = await verifyCopyStep(source, target, runId, expectedRevision, scope, witness, fence); break;
    case "finalize": result = await finalizeCopyReceipt(target, runId, expectedRevision, scope, fence); break;
  }
  try {
    const release = await db.prepare(`UPDATE cockpit_execution_control SET lease_token=NULL,lease_until_ms=0
      WHERE slot=1 AND run_id=? AND lease_token=? AND lease_until_ms>${DB_NOW_MS} AND expires_at_ms>${DB_NOW_MS} AND utc_day=${UTC_DAY}`)
      .bind(runId, fence.token).run();
    if (release.meta.changes !== 1) throw Error("EXECUTION_UNCONFIRMED");
  } catch { throw Error("EXECUTION_UNCONFIRMED"); }
  return result;
}
