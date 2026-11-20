import type { D1Database } from "@cloudflare/workers-types";

export const D1_V2_RECEIPT_ID = "cockpit-d1-cutover-v2";
const FORMAT = "cockpit-d1-stream-receipt-v2";
const HASH = /^[0-9a-f]{64}$/;
const RUN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

type ReceiptEvidence = {
  runId: string; schemaHash: string; scopeHash: string; copyHash: string; auditHash: string;
  rows: number; bytes: number; copyRevision: number; verificationRevision: number; witnesses: number;
};

function integerInRange(value: number, min: number, max: number) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

async function digestText(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

export function hashV2AuditEvidence(storedAnchors: string) {
  return digestText(JSON.stringify(["cockpit-d1-audit-evidence-v2", storedAnchors]));
}

/** The ordered serialization is the v2 wire format. The digest is pinned
 * separately by the operator. No account identifiers or business rows are stored.
 */
export async function makeV2Receipt(evidence: ReceiptEvidence) {
  const { runId, schemaHash, scopeHash, copyHash, auditHash, rows, bytes,
    copyRevision, verificationRevision, witnesses } = evidence;
  if (typeof runId !== "string" || !RUN.test(runId) ||
      ![schemaHash, scopeHash, copyHash, auditHash].every(v => typeof v === "string" && HASH.test(v)) ||
      !integerInRange(rows, 1, 2000) || !integerInRange(bytes, 1, 16 * 1024 * 1024) ||
      !integerInRange(witnesses, 1, Math.min(rows, 10)) || copyRevision !== rows + 18 ||
      verificationRevision !== copyRevision * 2 + witnesses)
    throw Error("Invalid D1 v2 receipt");
  const manifest = JSON.stringify({ format: FORMAT, runId, schemaHash, scopeHash, copyHash, auditHash,
    rows, bytes, copyRevision, verificationRevision, witnesses });
  return { manifest, sha256: await digestText(manifest) };
}

/** A detached target may be empty while the controlled run is in progress.
 * An existing legacy, conflicting, truncated or corrupt record is an error.
 */
export async function readV2Receipt(db: D1Database) {
  const primary = db.withSession("first-primary");
  const { results } = await primary.prepare(
    "SELECT id = ? AS correct_id, status = 'verified' AS verified, " +
    "CASE WHEN typeof(manifest)='text' AND length(CAST(manifest AS BLOB))<=2048 THEN manifest END AS manifest " +
    "FROM cockpit_cutover_receipt LIMIT 2",
  ).bind(D1_V2_RECEIPT_ID).all<{ correct_id: number; verified: number; manifest: string | null }>();
  if (results.length === 0) return null;
  const [row] = results;
  if (results.length !== 1 || row.correct_id !== 1 || row.verified !== 1 || typeof row.manifest !== "string")
    throw Error("Invalid D1 v2 receipt");
  try {
    const data = JSON.parse(row.manifest);
    const canonical = await makeV2Receipt(data);
    if (row.manifest !== canonical.manifest) throw Error();
    // Rebind the exact receipt to this target's durable run. The snapshot may
    // legitimately predate later application writes; never hash live user rows here.
    const matched = await primary.prepare(`SELECT CASE WHEN typeof(v.audit_json)='text' AND
      length(CAST(v.audit_json AS BLOB))<=16384 THEN v.audit_json END AS audit_json FROM cockpit_cutover_receipt r
      JOIN cockpit_execution_control e ON e.slot=1 AND e.run_id=?
      JOIN cockpit_copy_checkpoint c ON c.slot=e.slot AND c.run_id=e.run_id
      JOIN cockpit_copy_verification v ON v.slot=c.slot AND v.run_id=c.run_id
      WHERE r.id=? AND r.status='verified' AND r.manifest=? AND typeof(r.at_ms)='integer' AND r.at_ms>0
        AND NOT EXISTS(SELECT 1 FROM cockpit_cutover_receipt other WHERE other.id IS NOT r.id)
        AND c.phase='copied' AND c.schema_hash=? AND c.scope_hash=? AND c.copy_hash=?
        AND c.revision=? AND c.total_rows=? AND c.total_bytes=?
        AND c.table_index=18 AND c.table_rows=0 AND c.cursor_json IS NULL
        AND v.phase='matched' AND v.failure_code IS NULL AND v.copy_hash=c.copy_hash
        AND v.stream_hash=c.copy_hash AND v.scope_hash=c.scope_hash AND v.schema_hash=c.schema_hash
        AND v.copy_revision=c.revision AND v.revision=? AND v.witness_index=?
        AND v.table_index=c.table_index AND v.table_rows=0 AND v.cursor_json IS NULL
        AND v.expected_rows=c.total_rows AND v.expected_bytes=c.total_bytes
        AND v.total_rows=c.total_rows AND v.total_bytes=c.total_bytes
        AND e.attempts>=c.revision+v.revision+3`)
      .bind(data.runId, D1_V2_RECEIPT_ID, canonical.manifest, data.schemaHash, data.scopeHash, data.copyHash,
        data.copyRevision, data.rows, data.bytes, data.verificationRevision, data.witnesses).first<{ audit_json: string | null }>();
    if (typeof matched?.audit_json !== "string" || await hashV2AuditEvidence(matched.audit_json) !== data.auditHash) throw Error();
    return { runId: data.runId as string, sha256: canonical.sha256 };
  } catch { throw Error("Invalid D1 v2 receipt"); }
}
