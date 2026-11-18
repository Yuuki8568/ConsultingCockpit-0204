/** Internal only. Independent data/audit checks, not a production runner,
 * write freeze, v1 receipt or permission to activate D1.
 */
import type { Client } from "@libsql/client";
import type { D1Database, D1DatabaseSession } from "@cloudflare/workers-types";
import { migrationDefinitions as definitions } from "../packages/web/src/api/database/d1/migration-schema";
import { atomicCheckedBatch } from "../cloudflare/d1/atomic-batch";
import { getCopyVerificationBinding, type CopyScope } from "./d1-copy-checkpoint";
import { readBoundedMigrationRow, readBoundedTargetRow } from "./d1-bounded-reader";
import { streamRow, streamBoundary } from "./d1-stream-digest";
import { D1_V2_RECEIPT_ID, hashV2AuditEvidence, makeV2Receipt } from "../packages/web/src/d1-receipt-v2";
import schemaFile from "../cloudflare/d1/business-schema.sql" with { type: "text" };
import { BUSINESS_SCHEMA_CONTRACT } from "./d1-schema-contract";
import type { WitnessService } from "../packages/web/src/api/database/d1/witness";
import { parseAuditAnchors, captureAuditAnchor, verifyAuditEvent, verifyAuditHead, recheckAuditAnchor } from "./d1-bounded-audit";

import { inspectCatalog, queryInventorySession, assertVerificationControls, emptyTablesCondition } from "./d1-inventory";
import { mutationFence, DB_NOW_MS, STEP_RESERVE, type ExecutionFence } from "./d1-execution-schema";
import { FREE_D1_PLANNING_LIMITS as FREE } from "./d1-free-preflight";

export { COPY_VERIFICATION_SCHEMA } from "./d1-control-schema";
type Binding = Awaited<ReturnType<typeof getCopyVerificationBinding>>;
type Progress = {
  revision: number; table_index: number; cursor_json: string | null;
  table_rows: number; total_rows: number; total_bytes: number; stream_hash: string;
  phase: "target" | "source" | "witness" | "matched" | "failed"; failure_code: string | null;
  audit_json: string; witness_index: number;
};
const persistentFailures = new Set([
  "VERIFY_CONTENT_MISMATCH", "VERIFY_CAPACITY_MISMATCH", "BOUNDED_SCHEMA_MISMATCH",
  "BOUNDED_FOREIGN_KEY_MISMATCH",
  "BOUNDED_UNSUPPORTED_VALUE", "BOUNDED_ROW_TOO_LARGE", "BOUNDED_INVALID_CURSOR",
  "AUDIT_OWNER_MISMATCH", "AUDIT_CHAIN_INVALID", "AUDIT_HEAD_MISMATCH", "AUDIT_WITNESS_MISMATCH",
]);
const safeCodes = new Set([...persistentFailures, "VERIFY_NOT_STARTED", "VERIFY_CONTEXT_MISMATCH",
  "VERIFY_PROGRESS_INVALID", "VERIFY_SCHEMA_MISMATCH", "VERIFY_ALREADY_FAILED", "VERIFY_STALE_REVISION",
  "VERIFY_INITIALIZE_UNCONFIRMED", "VERIFY_COMMIT_UNCONFIRMED", "COPY_NOT_STARTED", "COPY_CONTEXT_MISMATCH", "AUDIT_WITNESS_UNAVAILABLE"]);
function safeError(error: unknown) {
  if (error instanceof Error && ["COPY_SCHEMA_MISMATCH", "INVENTORY_DESTINATION_MISMATCH"].includes(error.message))
    return Error("VERIFY_SCHEMA_MISMATCH");
  return Error(error instanceof Error && safeCodes.has(error.message) ? error.message : "VERIFY_QUERY_FAILED");
}
const natural = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const isHash = (h: unknown) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h);
async function checkTargetCatalog(db: D1DatabaseSession) {
  try { await inspectCatalog(queryInventorySession(db), "destination"); }
  catch (error) {
    if (error instanceof Error && error.message === "INVENTORY_DESTINATION_MISMATCH")
      throw Error("BOUNDED_SCHEMA_MISMATCH");
    throw error;
  }
}
async function load(db: D1DatabaseSession, b: Binding): Promise<Progress> {
  const r = await db.prepare("SELECT * FROM cockpit_copy_verification WHERE slot=1").first<Record<string, unknown>>();
  if (!r) throw Error("VERIFY_NOT_STARTED");
  if (r.run_id !== b.runId || r.schema_hash !== b.schemaHash || r.scope_hash !== b.scopeHash ||
      r.copy_hash !== b.copyHash || r.copy_revision !== b.revision || r.expected_rows !== b.totalRows || r.expected_bytes !== b.totalBytes)
    throw Error("VERIFY_CONTEXT_MISMATCH");
  if (![r.revision, r.table_index, r.table_rows, r.total_rows, r.total_bytes, r.witness_index].every(natural) || !isHash(r.stream_hash))
    throw Error("VERIFY_PROGRESS_INVALID");
  const p = r as unknown as Progress, passSteps = b.totalRows + definitions.length, anchors = parseAuditAnchors(p.audit_json);
  if (!["target", "source", "witness", "matched", "failed"].includes(p.phase) || p.table_index > definitions.length ||
      p.total_rows > b.totalRows || p.total_bytes > b.totalBytes || p.table_rows > p.total_rows ||
      p.revision > passSteps * 2 + 11 || p.witness_index > anchors.length ||
      (p.phase === "failed" ? !persistentFailures.has(p.failure_code ?? "") : p.failure_code !== null) ||
      (p.cursor_json === null ? p.table_rows !== 0 : p.table_rows === 0))
    throw Error("VERIFY_PROGRESS_INVALID");
  if (p.phase !== "failed") {
    const finishedPasses = p.phase === "matched" || p.phase === "witness";
    const expected = finishedPasses ? passSteps * 2 + p.witness_index : (p.phase === "target" ? 0 : passSteps) + p.total_rows + p.table_index;
    if (p.revision !== expected || (finishedPasses ?
        (p.table_index !== definitions.length || p.cursor_json !== null || p.stream_hash !== b.copyHash ||
          p.total_rows !== b.totalRows || p.total_bytes !== b.totalBytes || !anchors.length ||
          (p.phase === "matched" ? p.witness_index !== anchors.length : p.witness_index === anchors.length)) :
        (p.table_index === definitions.length || p.witness_index !== 0)))
      throw Error("VERIFY_PROGRESS_INVALID");
  }
  if (p.cursor_json !== null) {
    if (p.table_index === definitions.length || typeof p.cursor_json !== "string" ||
        new TextEncoder().encode(p.cursor_json).length > 65536) throw Error("VERIFY_PROGRESS_INVALID");
    let cursor: unknown;
    try { cursor = JSON.parse(p.cursor_json); } catch { throw Error("VERIFY_PROGRESS_INVALID"); }
    if (!Array.isArray(cursor) || cursor.length !== definitions[p.table_index].keys.length ||
        cursor.some(v => typeof v !== "string") || JSON.stringify(cursor) !== p.cursor_json)
      throw Error("VERIFY_PROGRESS_INVALID");
  }
  return p;
}
function summary(p: Progress) {
  return { revision: p.revision, phase: p.phase, tableIndex: p.table_index,
    passRows: p.total_rows, passJsonBytes: p.total_bytes, dataMatched: p.phase === "matched" || p.phase === "witness",
    failureCode: p.failure_code, auditVerified: p.phase === "matched", verified: false as const, cutoverAllowed: false as const };
}
const copyCondition = "EXISTS(SELECT 1 FROM cockpit_copy_checkpoint WHERE slot=1 AND run_id=? AND schema_hash=? AND scope_hash=? AND copy_hash=? AND revision=? AND total_rows=? AND total_bytes=? AND phase='copied')";
function copyArgs(b: Binding) { return [b.runId, b.schemaHash, b.scopeHash, b.copyHash, b.revision, b.totalRows, b.totalBytes]; }
async function commit(db: D1DatabaseSession, b: Binding, before: Progress, after: Progress, fence?: ExecutionFence) {
  try {
    await atomicCheckedBatch(db, [mutationFence(db, fence), { statement: db.prepare(`UPDATE cockpit_copy_verification SET revision=?,table_index=?,cursor_json=?,table_rows=?,total_rows=?,total_bytes=?,stream_hash=?,phase=?,failure_code=?,audit_json=?,witness_index=? WHERE slot=1 AND run_id=? AND schema_hash=? AND scope_hash=? AND copy_hash=? AND copy_revision=? AND expected_rows=? AND expected_bytes=? AND revision=? AND table_index=? AND cursor_json IS ? AND table_rows=? AND total_rows=? AND total_bytes=? AND stream_hash=? AND phase=? AND failure_code IS ? AND audit_json=? AND witness_index=? AND ${copyCondition}`)
      .bind(after.revision, after.table_index, after.cursor_json, after.table_rows, after.total_rows, after.total_bytes,
        after.stream_hash, after.phase, after.failure_code, after.audit_json, after.witness_index, ...copyArgs(b),
        before.revision, before.table_index, before.cursor_json, before.table_rows, before.total_rows,
        before.total_bytes, before.stream_hash, before.phase, before.failure_code, before.audit_json, before.witness_index, ...copyArgs(b)), expectedChanges: 1 }]);
  } catch { throw Error("VERIFY_COMMIT_UNCONFIRMED"); }
}

/** Caller provisions the separate verification schema. No auto-DDL, cleanup,
 * retry, new credentials or public entry. Cannot reuse a failed verification.
 */
export async function initializeCopyVerification(target: D1Database, runId: string, scope: CopyScope, fence?: ExecutionFence) {
  try {
    const b = await getCopyVerificationBinding(target, runId, scope), db = target.withSession("first-primary");
    await checkTargetCatalog(db);
    try {
      await atomicCheckedBatch(db, [mutationFence(db, fence), { statement: db.prepare(`INSERT INTO cockpit_copy_verification(slot,run_id,schema_hash,scope_hash,copy_hash,copy_revision,expected_rows,expected_bytes,revision,table_index,cursor_json,table_rows,total_rows,total_bytes,stream_hash,phase,failure_code,audit_json,witness_index) SELECT 1,?,?,?,?,?,?,?,0,0,NULL,0,0,0,?,'target',NULL,'[]',0 WHERE NOT EXISTS(SELECT 1 FROM cockpit_copy_verification) AND ${copyCondition}`)
        .bind(...copyArgs(b), b.startHash, ...copyArgs(b)), expectedChanges: 1 }]);
    } catch { throw Error("VERIFY_INITIALIZE_UNCONFIRMED"); }
    return summary(await load(db, b));
  } catch (error) { throw safeError(error); }
}
export async function getCopyVerificationStatus(target: D1Database, runId: string, scope: CopyScope) {
  try {
    const b = await getCopyVerificationBinding(target, runId, scope), db = target.withSession("first-primary");
    return summary(await load(db, b));
  } catch (error) { throw safeError(error); }
}

// Only the repository's CREATE statements enter this check. Their exact bytes
// must still match the independent schema contract. Never read unknown DDL
// into the process when comparing the final schema with this local evidence.
async function businessReceiptSchema() {
  const lines = schemaFile.split("\n");
  if (!lines[0].startsWith("-- ")) throw Error("FINALIZE_SCHEMA_MISMATCH");
  const statements = new Map<string, string>();
  for (const part of lines.slice(1).join("\n").split(";")) {
    const sql = part.trim();
    if (!sql) continue;
    const name = /^CREATE (?:UNIQUE )?(?:TABLE|INDEX) `([A-Za-z0-9_]+)` /.exec(sql)?.[1];
    if (!name || statements.has(name)) throw Error("FINALIZE_SCHEMA_MISMATCH");
    statements.set(name, sql);
  }
  const expected: [string, string | null][] = [];
  for (const table of BUSINESS_SCHEMA_CONTRACT) {
    for (const object of table.objects) {
      const sql = statements.get(object.name) ?? null;
      if (sql === null ? object.sqlSha256 !== null : object.sqlSha256 === null)
        throw Error("FINALIZE_SCHEMA_MISMATCH");
      if (sql !== null) {
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sql)));
        if (Array.from(hash, b => b.toString(16).padStart(2, "0")).join("") !== object.sqlSha256)
          throw Error("FINALIZE_SCHEMA_MISMATCH");
        statements.delete(object.name);
      }
      expected.push([object.name, sql]);
    }
  }
  if (statements.size) throw Error("FINALIZE_SCHEMA_MISMATCH");
  return JSON.stringify(expected);
}
let trustedBusinessSchema: Promise<string> | undefined;
const exactBusinessSql = `NOT EXISTS(SELECT 1 FROM json_each(?) expected
  LEFT JOIN main.sqlite_schema actual ON actual.name=json_extract(expected.value,'$[0]')
  WHERE actual.name IS NULL OR CAST(actual.sql AS BLOB) IS NOT CAST(json_extract(expected.value,'$[1]') AS BLOB))`;

// Repeat the validated catalog projection in the receipt statement. A competing
// DDL change to a control table, index or trigger must invalidate our check.
// The projection contains names and known definition IDs, never SQL or payloads.
async function receiptCatalog(db: D1DatabaseSession) {
  let projection = "", signature = "";
  let parameters: (string | number)[] = [];
  const catalog = await inspectCatalog(async (sql, args) => {
    projection = `SELECT json_group_array(json_object('name',name,'owner',owner,'type',type,
      'definition_id',definition_id,'implicit_index',implicit_index) ORDER BY name COLLATE BINARY)
      AS signature FROM (${sql})`;
    parameters = args;
    const row = await db.prepare(projection).bind(...args).first<{ signature: string }>();
    if (typeof row?.signature !== "string") throw Error("FINALIZE_SCHEMA_MISMATCH");
    signature = row.signature;
    return JSON.parse(signature);
  }, "destination");
  if (!["cockpit_cutover_receipt", "cockpit_atomic_assertion", "cockpit_copy_checkpoint",
    "cockpit_copy_verification", "cockpit_execution_control"].every(name => catalog.controls.includes(name)))
    throw Error("FINALIZE_SCHEMA_MISMATCH");
  const empty = catalog.controls.filter(name => ["cockpit_migration_run", "cockpit_migration_row",
    "cockpit_atomic_assertion"].includes(name));
  trustedBusinessSchema ??= businessReceiptSchema();
  return { condition: `(${projection})=? AND ${exactBusinessSql} AND ${emptyTablesCondition(empty)}`,
    args: [...parameters, signature, await trustedBusinessSchema] };
}

// Recheck the complete matched checkpoint, verification and current admission
// ledger in the same snapshot as insertion or readback. Daily counters may span
// a shorter period than the lifetime attempt counter when the run crosses UTC days.
const matchedRun = `EXISTS(SELECT 1 FROM main.cockpit_copy_checkpoint c
  JOIN main.cockpit_copy_verification v ON v.slot=c.slot AND v.run_id=c.run_id
  JOIN main.cockpit_execution_control e ON e.slot=c.slot AND e.run_id=c.run_id
  WHERE (c.slot=1 AND c.run_id=? AND c.schema_hash=? AND c.scope_hash=? AND c.copy_hash=?)
    AND (c.revision=? AND c.total_rows=? AND c.total_bytes=? AND c.phase='copied'
      AND c.table_index=? AND c.cursor_json IS NULL AND c.table_rows=0)
    AND (v.schema_hash=c.schema_hash AND v.scope_hash=c.scope_hash AND v.copy_hash=c.copy_hash
      AND v.copy_revision=c.revision AND v.expected_rows=c.total_rows AND v.expected_bytes=c.total_bytes)
    AND (v.revision=? AND v.phase='matched' AND v.failure_code IS NULL AND v.table_index=c.table_index
      AND v.cursor_json IS NULL AND v.table_rows=0)
    AND (v.total_rows=c.total_rows AND v.total_bytes=c.total_bytes AND v.stream_hash=c.copy_hash
      AND v.witness_index=? AND v.audit_json=?)
    AND (e.attempts BETWEEN c.revision+v.revision+3 AND e.max_attempts AND e.max_attempts<=12000
      AND e.attempts*${STEP_RESERVE.storageBytes}<=${FREE.databaseBytes})
    AND (e.reserved_requests BETWEEN ${STEP_RESERVE.requests} AND e.attempts*${STEP_RESERVE.requests}
      AND e.reserved_requests % ${STEP_RESERVE.requests}=0
      AND e.reserved_reads=e.reserved_requests/${STEP_RESERVE.requests}*${STEP_RESERVE.reads}
      AND e.reserved_writes=e.reserved_requests/${STEP_RESERVE.requests}*${STEP_RESERVE.writes})
    AND (e.daily_reads<=${FREE.rowsReadPerDay} AND e.daily_writes<=${FREE.rowsWrittenPerDay}
      AND e.daily_requests<=${FREE.workerRequestsPerDay})
    AND (e.observed_reads BETWEEN 0 AND ${FREE.rowsReadPerDay}-e.reserved_reads
      AND e.observed_writes BETWEEN 0 AND ${FREE.rowsWrittenPerDay}-e.reserved_writes
      AND e.observed_requests BETWEEN 0 AND ${FREE.workerRequestsPerDay}-e.reserved_requests)
    AND (e.observed_at_ms>0 AND e.utc_day=CAST(e.observed_at_ms/86400000 AS INTEGER)
      AND e.expires_at_ms>e.observed_at_ms AND e.lease_until_ms<=e.expires_at_ms))`;

async function receiptEvidence(target: D1Database, db: D1DatabaseSession, runId: string, expectedRevision: number, scope: CopyScope) {
  const catalog = await receiptCatalog(db);
  const b = await getCopyVerificationBinding(target, runId, scope), p = await load(db, b);
  if (p.phase !== "matched") throw Error("FINALIZE_NOT_MATCHED");
  if (!natural(expectedRevision) || p.revision !== expectedRevision) throw Error("FINALIZE_STALE_REVISION");
  const auditHash = await hashV2AuditEvidence(p.audit_json);
  const receipt = await makeV2Receipt({ runId, schemaHash: b.schemaHash, scopeHash: b.scopeHash,
    copyHash: b.copyHash, auditHash, rows: b.totalRows, bytes: b.totalBytes, copyRevision: b.revision,
    verificationRevision: p.revision, witnesses: p.witness_index });
  return { ...receipt, condition: `${matchedRun} AND ${catalog.condition}`,
    args: [...copyArgs(b), definitions.length, p.revision, p.witness_index, p.audit_json, ...catalog.args] };
}

function finalizationError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (["FINALIZE_NOT_MATCHED", "FINALIZE_STALE_REVISION", "FINALIZE_SCHEMA_MISMATCH",
    "FINALIZE_COMMIT_UNCONFIRMED", "FINALIZE_RECEIPT_MISMATCH"].includes(code)) return Error(code);
  if (["INVENTORY_DESTINATION_MISMATCH", "COPY_SCHEMA_MISMATCH"].includes(code)) return Error("FINALIZE_SCHEMA_MISMATCH");
  return Error("FINALIZE_EVIDENCE_INVALID");
}

/** Single controlled admission. No receipt overwrite, automatic retry or cutover. */
export async function finalizeCopyReceipt(target: D1Database, runId: string, expectedRevision: number,
  scope: CopyScope, fence: ExecutionFence) {
  if (!fence || fence.runId !== runId || !fence.token) throw Error("FINALIZE_FENCE_REQUIRED");
  try {
    const db = target.withSession("first-primary");
    const evidence = await receiptEvidence(target, db, runId, expectedRevision, scope);
    const insert = db.prepare(`INSERT INTO cockpit_cutover_receipt(id,status,at_ms,manifest)
      SELECT ?,'verified',${DB_NOW_MS},? WHERE NOT EXISTS(SELECT 1 FROM main.cockpit_cutover_receipt)
      AND ${evidence.condition}`).bind(D1_V2_RECEIPT_ID, evidence.manifest, ...evidence.args);
    try {
      await atomicCheckedBatch(db, [{ statement: insert, expectedChanges: 1 }, mutationFence(db, fence)]);
    } catch { throw Error("FINALIZE_COMMIT_UNCONFIRMED"); }
    return { sha256: evidence.sha256, cutoverAllowed: false as const };
  } catch (error) { throw finalizationError(error); }
}

/** Recover a lost acknowledgement without consuming a second admission. */
export async function getFinalizedCopyReceipt(target: D1Database, runId: string, expectedRevision: number, scope: CopyScope) {
  try {
    const db = target.withSession("first-primary");
    const evidence = await receiptEvidence(target, db, runId, expectedRevision, scope);
    const row = await db.prepare(`SELECT 1 AS ok FROM main.cockpit_cutover_receipt
      WHERE id=? AND status='verified' AND typeof(at_ms)='integer' AND at_ms>0 AND manifest=?
      AND NOT EXISTS(SELECT 1 FROM main.cockpit_cutover_receipt WHERE id IS NOT ?)
      AND ${evidence.condition}`).bind(D1_V2_RECEIPT_ID, evidence.manifest, D1_V2_RECEIPT_ID, ...evidence.args).first();
    if (!row) throw Error("FINALIZE_RECEIPT_MISMATCH");
    return { sha256: evidence.sha256, cutoverAllowed: false as const };
  } catch (error) { throw finalizationError(error); }
}

/** One stored row, table boundary or final witness recheck per call. Target is read from
 * storage before a separate source pass, never from cached copied rows.
 */
export async function verifyCopyStep(source: Pick<Client, "transaction">, target: D1Database,
  runId: string, expectedRevision: number, scope: CopyScope, witness?: WitnessService, fence?: ExecutionFence) {
  try {
    const b = await getCopyVerificationBinding(target, runId, scope), db = target.withSession("first-primary");
    const p = await load(db, b);
    if (!natural(expectedRevision) || p.revision !== expectedRevision) throw Error("VERIFY_STALE_REVISION");
    if (p.phase === "failed") throw Error("VERIFY_ALREADY_FAILED");
    if (p.phase === "matched") return summary(p);
    let next: Progress;
    try {
      await checkTargetCatalog(db);
      const anchors = parseAuditAnchors(p.audit_json);
      if (p.phase === "witness") {
        await recheckAuditAnchor(db, witness, anchors[p.witness_index]);
        next = { ...p, revision: p.revision + 1, witness_index: p.witness_index + 1 };
        if (next.witness_index === anchors.length) next.phase = "matched";
      } else {
        const table = definitions[p.table_index], cursor = p.cursor_json === null ? null : JSON.parse(p.cursor_json);
        const row = p.phase === "target" ? await readBoundedTargetRow(target, table.name, cursor) :
          await readBoundedMigrationRow(source, table.name, cursor);
        next = { ...p, revision: p.revision + 1 };
        if (!row.done) {
          next.table_rows++; next.total_rows++; next.total_bytes += row.jsonBytes;
          if (next.total_rows > b.totalRows || next.total_bytes > b.totalBytes) throw Error("VERIFY_CAPACITY_MISMATCH");
          next.cursor_json = JSON.stringify(row.cursor);
          next.stream_hash = await streamRow(p.stream_hash, p.table_index, row.values);
          if (p.phase === "target") {
            const values = Object.fromEntries(row.columns.map((c, i) => [c, row.values[i]]));
            if (table.name === "user") {
              anchors.push(await captureAuditAnchor(db, witness, values.id as string));
              next.audit_json = JSON.stringify(anchors); parseAuditAnchors(next.audit_json);
            } else if (table.name === "audit_event") await verifyAuditEvent(db, values, anchors);
            else if (table.name === "audit_head") verifyAuditHead(values, anchors);
          }
        } else {
          next.stream_hash = await streamBoundary(p.stream_hash, p.table_index, p.table_rows, p.total_rows, p.total_bytes);
          next.table_index++; next.cursor_json = null; next.table_rows = 0;
          if (next.table_index === definitions.length) {
            if (next.total_rows !== b.totalRows || next.total_bytes !== b.totalBytes || next.stream_hash !== b.copyHash)
              throw Error("VERIFY_CONTENT_MISMATCH");
            if (p.phase === "target") Object.assign(next, { phase: "source", table_index: 0, total_rows: 0, total_bytes: 0, stream_hash: b.startHash });
            else next.phase = "witness";
          }
        }
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (persistentFailures.has(code)) {
        // Inspect again after the failed check before trusting mutation targets.
        // A damaged control table never receives a failure receipt.
        await assertVerificationControls(db);
        await commit(db, b, p, { ...p, revision: p.revision + 1, phase: "failed", failure_code: code }, fence);
      }
      throw error;
    }
    await commit(db, b, p, next, fence);
    return summary(next);
  } catch (error) { throw safeError(error); }
}
