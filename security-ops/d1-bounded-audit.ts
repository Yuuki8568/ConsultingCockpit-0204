/** Bounded, read-only audit checks for a frozen detached D1 copy. No witness
 * publication: a missing/unavailable witness never becomes a successful check.
 */
import type { D1DatabaseSession } from "@cloudflare/workers-types";
import type { WitnessService } from "../packages/web/src/api/database/d1/witness";
import { auditHash } from "../packages/web/src/api/security/audit";
export type AuditAnchor = { userId: string; headSeq: number; headHash: string; anchorSeq: number; anchorHash: string };
const hash = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const natural = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const validHead = (seq: unknown, value: unknown) => natural(seq) && (seq === 0 ? value === "GENESIS" : hash(value));

export function parseAuditAnchors(text: unknown): AuditAnchor[] {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > 16384) throw Error("VERIFY_PROGRESS_INVALID");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw Error("VERIFY_PROGRESS_INVALID"); }
  if (!Array.isArray(value) || value.length > 10 || JSON.stringify(value) !== text || value.some(a =>
    !a || typeof a.userId !== "string" || !a.userId || new TextEncoder().encode(a.userId).length > 512 ||
    !validHead(a.headSeq, a.headHash) || !validHead(a.anchorSeq, a.anchorHash) || a.anchorSeq > a.headSeq ||
    Object.keys(a).sort().join(",") !== "anchorHash,anchorSeq,headHash,headSeq,userId") ||
    new Set(value.map(a => a.userId)).size !== value.length) throw Error("VERIFY_PROGRESS_INVALID");
  return value;
}
async function witnessHead(service: WitnessService | undefined, userId: string) {
  if (!service) throw Error("AUDIT_WITNESS_UNAVAILABLE");
  try {
    const res = await service.fetch(new Request(`https://witness/head?user=${encodeURIComponent(userId)}`));
    if (!res.ok || !res.body) throw Error();
    const reader = res.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const r = await reader.read(); if (r.done) break;
        length += r.value.byteLength; if (length > 4096) { await reader.cancel(); throw Error(); }
        chunks.push(r.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!validHead(value.seq, value.hash)) throw Error();
    return { seq: value.seq as number, hash: value.hash as string };
  } catch { throw Error("AUDIT_WITNESS_UNAVAILABLE"); }
}
async function targetHead(db: D1DatabaseSession, userId: string) {
  const head = await db.prepare("SELECT CASE WHEN typeof(seq)='integer' THEN seq END AS seq,CASE WHEN typeof(hash)='text' AND length(CAST(hash AS BLOB)) IN (7,64) THEN hash END AS hash FROM audit_head WHERE user_id=?").bind(userId).first<{seq: unknown; hash: unknown}>();
  const counts = await db.prepare("SELECT count(*) AS n,coalesce(max(CASE WHEN typeof(seq)='integer' THEN seq END),0) AS last,coalesce(sum(CASE WHEN typeof(seq)='integer' AND seq>0 THEN 0 ELSE 1 END),0) AS invalid FROM audit_event WHERE user_id=?").bind(userId).first<{n: number; last: number; invalid: number}>();
  const seq = head ? head.seq : 0, value = head ? head.hash : "GENESIS";
  if (!validHead(seq, value) || !counts || !natural(counts.n) || counts.n > 2000 || counts.invalid !== 0 ||
      counts.n !== seq || counts.last !== seq) throw Error("AUDIT_HEAD_MISMATCH");
  return { seq: seq as number, hash: value as string };
}
export async function captureAuditAnchor(db: D1DatabaseSession, service: WitnessService | undefined, userId: string): Promise<AuditAnchor> {
  if (!userId || new TextEncoder().encode(userId).length > 512) throw Error("AUDIT_OWNER_MISMATCH");
  const head = await targetHead(db, userId), anchor = await witnessHead(service, userId);
  if (anchor.seq > head.seq) throw Error("AUDIT_WITNESS_MISMATCH");
  return { userId, headSeq: head.seq, headHash: head.hash, anchorSeq: anchor.seq, anchorHash: anchor.hash };
}
export async function verifyAuditEvent(db: D1DatabaseSession, row: Record<string, unknown>, anchors: AuditAnchor[]) {
  const a = anchors.find(v => v.userId === row.user_id);
  if (!a) throw Error("AUDIT_OWNER_MISMATCH");
  if (!natural(row.seq) || row.seq === 0 || row.seq > a.headSeq || !natural(row.at_ms) ||
      ![1, 2].includes(row.hash_version as number) || typeof row.action !== "string" || !hash(row.hash) ||
      !validHead(row.seq - 1, row.prev_hash) ||
      [row.device_id, row.payload_ciphertext, row.payload_iv].some(v => v !== null && typeof v !== "string"))
    throw Error("AUDIT_CHAIN_INVALID");
  const duplicates = await db.prepare("SELECT count(*) AS n FROM (SELECT 1 FROM audit_event WHERE user_id=? AND seq=? LIMIT 2)").bind(a.userId, row.seq).first<{ n: number }>();
  if (duplicates?.n !== 1) throw Error("AUDIT_CHAIN_INVALID");
  if (row.seq > 1) {
    const previous = await db.prepare("SELECT CASE WHEN typeof(hash)='text' AND length(CAST(hash AS BLOB))=64 THEN hash END AS hash FROM audit_event WHERE user_id=? AND seq=? LIMIT 2").bind(a.userId, row.seq - 1).all<{hash: unknown}>();
    if (previous.results.length !== 1 || previous.results[0].hash !== row.prev_hash) throw Error("AUDIT_CHAIN_INVALID");
  }
  const computed = await auditHash({ hashVersion: row.hash_version as number, userId: a.userId,
    seq: row.seq, action: row.action, atMs: row.at_ms, deviceId: row.device_id as string | null,
    payloadCiphertext: row.payload_ciphertext as string | null, payloadIv: row.payload_iv as string | null, prevHash: row.prev_hash as string });
  if (computed !== row.hash || (row.seq === a.headSeq && computed !== a.headHash)) throw Error("AUDIT_CHAIN_INVALID");
  if (row.seq === a.anchorSeq && computed !== a.anchorHash) throw Error("AUDIT_WITNESS_MISMATCH");
}
export function verifyAuditHead(row: Record<string, unknown>, anchors: AuditAnchor[]) {
  const a = anchors.find(v => v.userId === row.user_id);
  if (!a) throw Error("AUDIT_OWNER_MISMATCH");
  if (row.seq !== a.headSeq || row.hash !== a.headHash) throw Error("AUDIT_HEAD_MISMATCH");
}
export async function recheckAuditAnchor(db: D1DatabaseSession, service: WitnessService | undefined, a: AuditAnchor) {
  const head = await targetHead(db, a.userId), witness = await witnessHead(service, a.userId);
  if (head.seq !== a.headSeq || head.hash !== a.headHash) throw Error("AUDIT_HEAD_MISMATCH");
  if (witness.seq !== a.anchorSeq || witness.hash !== a.anchorHash) throw Error("AUDIT_WITNESS_MISMATCH");
}
