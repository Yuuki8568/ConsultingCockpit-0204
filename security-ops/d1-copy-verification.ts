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
import type { WitnessService } from "../packages/web/src/api/database/d1/witness";
import { parseAuditAnchors, captureAuditAnchor, verifyAuditEvent, verifyAuditHead, recheckAuditAnchor } from "./d1-bounded-audit";

import { inspectCatalog, queryInventorySession, assertVerificationControls } from "./d1-inventory";
import { mutationFence, type ExecutionFence } from "./d1-execution-schema";

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
