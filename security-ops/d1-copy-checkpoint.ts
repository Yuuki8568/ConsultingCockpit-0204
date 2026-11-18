/** Internal prototype; no HTTP/cron entry, deployment, receipt or cutover path.
 * Only use a detached target while ALL source writers are stopped. These
 * caller assertions do not establish a freeze, schema parity or audit validity.
 * A copied result is never a verified migration. Independent passes are still required.
 */
import type { Client } from "@libsql/client";
import type { D1Database, D1DatabaseSession } from "@cloudflare/workers-types";
import { migrationDefinitions as definitions } from "../packages/web/src/api/database/d1/migration-schema";
import { atomicCheckedBatch } from "../cloudflare/d1/atomic-batch";
import { readBoundedMigrationRow } from "./d1-bounded-reader";
import { STREAM_FORMAT, streamStart, streamRow, streamBoundary } from "./d1-stream-digest";
import { assertBusinessSchema } from "./d1-schema-guard";
import { inspectCatalog, queryInventorySession, emptyTablesCondition, assertVerificationControls } from "./d1-inventory";
import { BUSINESS_SCHEMA_CONTRACT } from "./d1-schema-contract";

import { mutationFence, type ExecutionFence } from "./d1-execution-schema";

export { COPY_CHECKPOINT_SCHEMA } from "./d1-control-schema";
export type CopyScope = {
  maintenanceConfirmed: boolean;
  destinationDetached: boolean;
  // Stable caller-supplied digest identifying the source, not a credential.
  // The future runner must derive and verify it against the actual connection.
  sourceIdentitySha256: string;
  ownerEmails: readonly string[];
};
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const encode = new TextEncoder();
const TOTAL_ROWS = 2000, TOTAL_BYTES = 16 * 1024 * 1024;

const safeCodes = new Set([
  "COPY_SCOPE_REQUIRED", "COPY_INVALID_RUN", "COPY_CONTEXT_MISMATCH", "COPY_CHECKPOINT_INVALID",
  "COPY_NOT_STARTED", "COPY_STALE_REVISION", "COPY_SCHEMA_MISMATCH", "COPY_CAPACITY_EXCEEDED",
  "COPY_OWNER_MISMATCH", "COPY_INITIALIZE_UNCONFIRMED", "COPY_COMMIT_UNCONFIRMED",
  "BOUNDED_SCHEMA_MISMATCH", "BOUNDED_UNSUPPORTED_VALUE", "BOUNDED_ROW_TOO_LARGE",
  "BOUNDED_QUERY_FAILED", "BOUNDED_INVALID_CURSOR", "BOUNDED_INVALID_LIMIT", "BOUNDED_UNKNOWN_TABLE",
  "BOUNDED_FOREIGN_KEY_MISMATCH",
]);
function safeError(error: unknown) {
  return Error(error instanceof Error && safeCodes.has(error.message) ? error.message : "COPY_QUERY_FAILED");
}
async function digest(value: unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encode.encode(JSON.stringify(value)))),
    b => b.toString(16).padStart(2, "0")).join("");
}
async function context(runId: string, scope: CopyScope) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(runId)) throw Error("COPY_INVALID_RUN");
  if (scope.maintenanceConfirmed !== true || scope.destinationDetached !== true ||
      !/^[0-9a-f]{64}$/.test(scope.sourceIdentitySha256) || !Array.isArray(scope.ownerEmails) ||
      scope.ownerEmails.length < 1 || scope.ownerEmails.length > 10 ||
      scope.ownerEmails.some(e => typeof e !== "string" || !e.trim() || e.length > 320))
    throw Error("COPY_SCOPE_REQUIRED");
  const owners = [...new Set(scope.ownerEmails.map(e => e.trim().toLowerCase()))].sort();
  const sourceIdentity = scope.sourceIdentitySha256;
  return { owners, schemaHash: await digest([STREAM_FORMAT, definitions, BUSINESS_SCHEMA_CONTRACT]),
    scopeHash: await digest([sourceIdentity, owners]) };
}
type CopyContext = Awaited<ReturnType<typeof context>>;
type Checkpoint = {
  copy_hash: string;
  revision: number; table_index: number; cursor_json: string | null;
  table_rows: number; total_rows: number; total_bytes: number; phase: "copying" | "copied";
};
function natural(n: unknown) { return typeof n === "number" && Number.isSafeInteger(n) && n >= 0; }
async function load(db: D1DatabaseSession, runId: string, ctx: CopyContext): Promise<Checkpoint> {
  const r = await db.prepare("SELECT run_id,schema_hash,scope_hash,copy_hash,revision,table_index,cursor_json,table_rows,total_rows,total_bytes,phase FROM cockpit_copy_checkpoint WHERE slot=1").first<Record<string, unknown>>();
  if (!r) throw Error("COPY_NOT_STARTED");
  if (r.run_id !== runId || r.schema_hash !== ctx.schemaHash || r.scope_hash !== ctx.scopeHash)
    throw Error("COPY_CONTEXT_MISMATCH");
  if (![r.revision, r.table_index, r.table_rows, r.total_rows, r.total_bytes].every(natural))
    throw Error("COPY_CHECKPOINT_INVALID");
  const cp = r as unknown as Checkpoint;
  if (typeof cp.copy_hash !== "string" || !/^[0-9a-f]{64}$/.test(cp.copy_hash) ||
      cp.table_index > definitions.length || cp.total_rows > TOTAL_ROWS || cp.total_bytes > TOTAL_BYTES ||
      cp.table_rows > cp.total_rows || cp.revision !== cp.total_rows + cp.table_index ||
      cp.phase !== (cp.table_index === definitions.length ? "copied" : "copying") ||
      (cp.cursor_json === null ? cp.table_rows !== 0 : cp.table_rows === 0) ||
      (cp.phase === "copied" && (cp.cursor_json !== null || !cp.total_rows)))
    throw Error("COPY_CHECKPOINT_INVALID");
  if (cp.cursor_json !== null) {
    if (typeof cp.cursor_json !== "string" || encode.encode(cp.cursor_json).length > 65536)
      throw Error("COPY_CHECKPOINT_INVALID");
    let parsed: unknown;
    try { parsed = JSON.parse(cp.cursor_json); } catch { throw Error("COPY_CHECKPOINT_INVALID"); }
    if (!Array.isArray(parsed) || parsed.length !== definitions[cp.table_index].keys.length ||
        parsed.some(v => typeof v !== "string") || JSON.stringify(parsed) !== cp.cursor_json)
      throw Error("COPY_CHECKPOINT_INVALID");
  }
  return cp;
}
function summary(cp: Checkpoint) {
  return { revision: cp.revision, tableIndex: cp.table_index, rowsCopied: cp.total_rows,
    jsonBytesCopied: cp.total_bytes, phase: cp.phase, verified: false as const, cutoverAllowed: false as const };
}
export async function checkCopyLayout(db: D1DatabaseSession, indices: number[]) {
  const query = queryInventorySession(db);
  let catalog;
  try { catalog = await inspectCatalog(query, "destination"); }
  catch (error) {
    throw Error(error instanceof Error && error.message === "INVENTORY_DESTINATION_MISMATCH" ? "COPY_SCHEMA_MISMATCH" : "COPY_QUERY_FAILED");
  }
  if (!["cockpit_copy_checkpoint", "cockpit_atomic_assertion"].every(t => catalog.controls.includes(t)))
    throw Error("COPY_SCHEMA_MISMATCH");
  // The pinned CREATE TABLE includes every column and the ordered primary key.
  // The schema tests check these same bytes against the ORM migration definitions.
  for (const index of indices) {
    try { await assertBusinessSchema(query, definitions[index].name); }
    catch (error) {
      throw Error(error instanceof Error && error.message === "SCHEMA_DEFINITION_MISMATCH" ? "COPY_SCHEMA_MISMATCH" : "COPY_QUERY_FAILED");
    }
  }
  return catalog;
}

/** Provision COPY_CHECKPOINT_SCHEMA + existing business/assertion schemas only in
 * a detached target first. Never auto-create/clear/replace business tables here.
 * A response lost after commit requires getBoundedCopyStatus with the SAME run.
 */
export async function initializeBoundedCopy(target: D1Database, runId: string, scope: CopyScope, fence?: ExecutionFence) {
  try {
    const ctx = await context(runId, scope), db = target.withSession("first-primary");
    const catalog = await checkCopyLayout(db, definitions.map((_, i) => i));
    const controlsToCheck = catalog.controls.filter(name => !fence || name !== "cockpit_execution_control");
    const emptiness = emptyTablesCondition([...definitions.map(d => d.name), ...controlsToCheck]);
    try {
      // Check the originally empty assertion table before this batch adds its own scratch rows.
      // The trailing lease check still rolls the entire batch back on expiry or takeover.
      await atomicCheckedBatch(db, [{ statement: db.prepare(`INSERT INTO cockpit_copy_checkpoint(slot,run_id,schema_hash,scope_hash,copy_hash,revision,table_index,cursor_json,table_rows,total_rows,total_bytes,phase) SELECT 1,?,?,?,?,0,0,NULL,0,0,0,'copying' WHERE ${emptiness}`)
        .bind(runId, ctx.schemaHash, ctx.scopeHash, await streamStart(runId, ctx.schemaHash, ctx.scopeHash)), expectedChanges: 1 }, mutationFence(db, fence)]);
    } catch { throw Error("COPY_INITIALIZE_UNCONFIRMED"); }
    return summary(await load(db, runId, ctx));
  } catch (error) { throw safeError(error); }
}

/** Private operational aggregates only: no payload, key cursor or credentials. */
export async function getBoundedCopyStatus(target: D1Database, runId: string, scope: CopyScope) {
  try { return summary(await load(target.withSession("first-primary"), runId, await context(runId, scope))); }
  catch (error) { throw safeError(error); }
}

/** Private binding for independent verification; never an activation manifest. */
export async function getCopyVerificationBinding(target: D1Database, runId: string, scope: CopyScope) {
  try {
    const ctx = await context(runId, scope), db = target.withSession("first-primary");
    try { await assertVerificationControls(db); }
    catch (error) {
      throw Error(error instanceof Error && error.message === "INVENTORY_DESTINATION_MISMATCH" ? "COPY_SCHEMA_MISMATCH" : "COPY_QUERY_FAILED");
    }
    const cp = await load(db, runId, ctx);
    if (cp.phase !== "copied") throw Error("COPY_NOT_STARTED");
    return { runId, schemaHash: ctx.schemaHash, scopeHash: ctx.scopeHash,
      copyHash: cp.copy_hash, startHash: await streamStart(runId, ctx.schemaHash, ctx.scopeHash),
      revision: cp.revision, totalRows: cp.total_rows, totalBytes: cp.total_bytes, format: STREAM_FORMAT };
  } catch (error) { throw safeError(error); }
}

/** Exactly one row or table boundary per call. No auto-retry, background loop,
 * lease, daily-quota scheduler or failure recovery policy is implemented here.
 * All source readers are read-only. The CAS and INSERT commit or roll back together.
 */
export async function copyBoundedStep(source: Pick<Client, "transaction">, target: D1Database,
  runId: string, expectedRevision: number, scope: CopyScope, fence?: ExecutionFence) {
  try {
    const ctx = await context(runId, scope), db = target.withSession("first-primary");
    if (!natural(expectedRevision)) throw Error("COPY_STALE_REVISION");
    const cp = await load(db, runId, ctx);
    if (cp.revision !== expectedRevision) throw Error("COPY_STALE_REVISION");
    if (cp.phase === "copied") return summary(cp);
    await checkCopyLayout(db, [cp.table_index]);
    const def = definitions[cp.table_index];
    const row = await readBoundedMigrationRow(source, def.name, cp.cursor_json === null ? null : JSON.parse(cp.cursor_json));
    const next: Checkpoint = { ...cp, revision: cp.revision + 1 };
    if (row.done) {
      if (cp.table_index === 0 && cp.table_rows === 0) throw Error("COPY_OWNER_MISMATCH");
      next.copy_hash = await streamBoundary(cp.copy_hash, cp.table_index, cp.table_rows, cp.total_rows, cp.total_bytes);
      next.table_index++; next.cursor_json = null; next.table_rows = 0;
      if (next.table_index === definitions.length) next.phase = "copied";
    } else {
      if (def.name === "user" && (!ctx.owners.includes(String(row.values[def.columns.indexOf("email")]).trim().toLowerCase()) ||
          row.values[def.columns.indexOf("email_verified")] !== 1)) throw Error("COPY_OWNER_MISMATCH");
      next.table_rows++; next.total_rows++; next.total_bytes += row.jsonBytes;
      if (next.total_rows > TOTAL_ROWS || next.total_bytes > TOTAL_BYTES ||
          (def.name === "record" && next.table_rows > 1000) || (def.name === "session" && next.table_rows > 100))
        throw Error("COPY_CAPACITY_EXCEEDED");
      next.cursor_json = JSON.stringify(row.cursor);
      next.copy_hash = await streamRow(cp.copy_hash, cp.table_index, row.values);
    }
    const update = db.prepare(`UPDATE cockpit_copy_checkpoint SET revision=?,table_index=?,cursor_json=?,table_rows=?,total_rows=?,total_bytes=?,phase=?,copy_hash=? WHERE slot=1 AND run_id=? AND schema_hash=? AND scope_hash=? AND revision=? AND table_index=? AND cursor_json IS ? AND table_rows=? AND total_rows=? AND total_bytes=? AND phase='copying' AND copy_hash=?`)
      .bind(next.revision, next.table_index, next.cursor_json, next.table_rows, next.total_rows, next.total_bytes, next.phase, next.copy_hash,
        runId, ctx.schemaHash, ctx.scopeHash, cp.revision, cp.table_index, cp.cursor_json, cp.table_rows, cp.total_rows, cp.total_bytes, cp.copy_hash);
    const mutations = [{ statement: update, expectedChanges: 1 }];
    if (!row.done) mutations.push({ statement: db.prepare(`INSERT INTO ${quote(def.name)} (${def.columns.map(quote).join(",")}) VALUES (${def.columns.map(() => "?").join(",")})`).bind(...row.values), expectedChanges: 1 });
    try { await atomicCheckedBatch(db, [mutationFence(db, fence), ...mutations]); }
    catch { throw Error("COPY_COMMIT_UNCONFIRMED"); }
    return summary(next);
  } catch (error) { throw safeError(error); }
}
