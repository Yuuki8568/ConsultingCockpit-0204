import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import * as s from "../database/schema";
import { auditHash } from "./audit";
import { selectWitnessPage, WITNESS_PAGE_BYTES, WITNESS_ROW_OVERHEAD } from "./witness-page";
import type { AuditVerificationResult } from "../../shared/audit-verification";

export const AUDIT_VERIFICATION_PAGE_ROWS = 100;
const PURPOSE = "cockpit-audit-verification-v1";
const TTL_SECONDS = 30 * 60;
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^(GENESIS|[0-9a-f]{64})$/);
const point = z.object({ seq: integer, hash });
const cursorSchema = z.object({
  version: z.literal(1), backend: z.enum(["libsql", "d1"]), sessionId: z.string(),
  target: point, witness: point, position: point, witnessed: z.boolean(),
  startedAtMs: integer, exp: integer,
});
type Cursor = z.infer<typeof cursorSchema>;
export const auditVerificationInput = z.object({ cursor: z.string().max(4096).optional() }).nullish();
type AuditDb = Pick<BaseSQLiteDatabase<"async", unknown, typeof s>, "select">;
type AuditRow = typeof s.auditEvent.$inferSelect;
export interface AuditReader {
  head(): Promise<{ seq: number; hash: string } | undefined>;
  latest(): Promise<{ seq: number; hash: string } | undefined>;
  hashAt(seq: number): Promise<string | undefined>;
  metadata(after: number, through: number): Promise<{ seq: number; hash: string; bytes: number }[]>;
  rows(after: number, through: number): Promise<AuditRow[]>;
}

// Include every variable-width column, including corrupted metadata, in the
// read bound. Counts/lengths are read before any encrypted payload is loaded.
const rowBytes = sql<number>`coalesce(length(CAST(id AS BLOB)),0)
  +coalesce(length(CAST(user_id AS BLOB)),0)+coalesce(length(CAST(action AS BLOB)),0)
  +coalesce(length(CAST(device_id AS BLOB)),0)+coalesce(length(CAST(payload_ciphertext AS BLOB)),0)
  +coalesce(length(CAST(payload_iv AS BLOB)),0)+coalesce(length(CAST(prev_hash AS BLOB)),0)
  +coalesce(length(CAST(hash AS BLOB)),0)`;

/** Both backends use the same user-scoped, bounded SQL and verifier. */
export function auditReader(db: AuditDb, userId: string): AuditReader {
  const user = eq(s.auditEvent.userId, userId);
  // A malformed DB hash must fail validation without transferring unbounded
  // text during the metadata-only reads. Valid hashes are exactly 64 chars.
  const eventHash = sql<string>`substr(${s.auditEvent.hash},1,65)`;
  return {
    head: async () => (await db.select({ seq: s.auditHead.seq, hash: sql<string>`substr(${s.auditHead.hash},1,65)` })
      .from(s.auditHead).where(eq(s.auditHead.userId, userId)).limit(1))[0],
    latest: async () => (await db.select({ seq: s.auditEvent.seq, hash: eventHash })
      .from(s.auditEvent).where(user).orderBy(desc(s.auditEvent.seq)).limit(1))[0],
    hashAt: async seq => (await db.select({ hash: eventHash }).from(s.auditEvent)
      .where(and(user, eq(s.auditEvent.seq, seq))).limit(1))[0]?.hash,
    metadata: async (after, through) => db.select({ seq: s.auditEvent.seq, hash: eventHash, bytes: rowBytes })
      .from(s.auditEvent).where(and(user, gt(s.auditEvent.seq, after), lte(s.auditEvent.seq, through)))
      .orderBy(s.auditEvent.seq).limit(AUDIT_VERIFICATION_PAGE_ROWS),
    rows: async (after, through) => db.select().from(s.auditEvent).where(and(
      user, gt(s.auditEvent.seq, after), lte(s.auditEvent.seq, through),
      sql`(SELECT coalesce(sum(${rowBytes}+${WITNESS_ROW_OVERHEAD}),0) FROM audit_event
        WHERE user_id=${userId} AND seq>${after} AND seq<=${through})<=${WITNESS_PAGE_BYTES}`,
    )).orderBy(s.auditEvent.seq).limit(AUDIT_VERIFICATION_PAGE_ROWS),
  };
}

async function cursorKey(secret: string) {
  if (secret.length < 32) throw new Error("Audit verification key unavailable");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256",
    salt: encoder.encode(PURPOSE), info: encoder.encode("cursor-signing") }, key, 256));
}

export async function verifyAuditPage(options: {
  reader: AuditReader; userId: string; sessionId: string; backend: "libsql" | "d1";
  witness: () => Promise<{ seq: number; hash: string }>; secret: string;
  cursor?: string; now?: number;
}): Promise<AuditVerificationResult> {
  const { reader, userId, sessionId, backend } = options;
  const now = options.now ?? Date.now();
  let checked = 0, total = 0, startedAtMs = now;
  const bad = (reason: string): AuditVerificationResult => ({
    ok: false, complete: true, checked, total, startedAtMs, startsAtSeq: checked ? 1 : 0, reason,
  });
  try {
    const key = await cursorKey(options.secret);
    let state: Cursor;
    if (options.cursor) {
      // The caller cannot select a starting sequence, claim prior progress, or
      // replay another user's/session's/backend's verification cursor.
      const { payload } = await jwtVerify(options.cursor, key, {
        algorithms: ["HS256"], audience: PURPOSE, subject: userId, currentDate: new Date(now),
      });
      state = cursorSchema.parse(payload);
      if (state.sessionId !== sessionId || state.backend !== backend ||
          state.startedAtMs > now || now - state.startedAtMs > TTL_SECONDS * 1000 ||
          state.position.seq <= 0 || state.position.seq >= state.target.seq ||
          state.witness.seq <= 0 || state.witness.seq > state.target.seq)
        return bad("検証の続き情報が無効です。最初から確認してください。");
    } else {
      const target = point.parse(await reader.head());
      const witness = point.parse(await options.witness());
      if (!target.seq || !witness.seq) return bad("独立保存先への初回記録を待っています");
      if (witness.seq > target.seq) return bad("独立保存先より監査記録が短くなっています");
      state = { version: 1, backend, sessionId, target, witness,
        position: { seq: 0, hash: "GENESIS" }, witnessed: false, startedAtMs: now,
        exp: Math.floor(now / 1000) + TTL_SECONDS };
    }
    checked = state.position.seq; total = state.target.seq; startedAtMs = state.startedAtMs;
    const same = (a: { seq: number; hash: string } | undefined) =>
      a?.seq === state.target.seq && a.hash === state.target.hash;
    // Any append/rollback during this run invalidates the pinned end. Never
    // silently skip newly added rows and present a partial run as a full pass.
    if (!same(await reader.head()) || !same(await reader.latest()))
      return bad("確認中に監査記録の末尾が変わりました。最初から確認してください。");
    if (checked && await reader.hashAt(checked) !== state.position.hash)
      return bad("前回確認した地点が一致しません");
    const metadata = await reader.metadata(checked, total);
    if (metadata.length > AUDIT_VERIFICATION_PAGE_ROWS) return bad("検証ページの件数が不正です");
    const page = selectWitnessPage(metadata, checked);
    if (!page.rows.length) return bad("監査記録に欠落があります");
    const rows = await reader.rows(checked, page.cursor);
    if (rows.length !== page.rows.length || rows.some((r, i) =>
      r.seq !== page.rows[i].seq || r.hash !== page.rows[i].hash))
      return bad("確認中に監査記録の内容・容量が変わりました");
    let previous = state.position.hash;
    for (const row of rows) {
      if (row.userId !== userId || row.seq !== checked + 1 || row.prevHash !== previous ||
          await auditHash(row) !== row.hash) return bad("監査記録の連鎖が一致しません");
      if (row.seq === state.witness.seq) {
        if (row.hash !== state.witness.hash) return bad("独立保存先と一致しません");
        state.witnessed = true;
      }
      checked = row.seq; previous = row.hash;
    }
    if (!same(await reader.head()) || !same(await reader.latest()))
      return bad("確認中に監査記録の末尾が変わりました。最初から確認してください。");
    if (checked < total) {
      const cursor = await new SignJWT({ ...state, position: { seq: checked, hash: previous } })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(userId)
        .setAudience(PURPOSE).sign(key);
      return { ok: false, complete: false, checked, total, startedAtMs, startsAtSeq: 1, cursor,
        reason: "検証途中のため全件の確認はまだ完了していません" };
    }
    if (checked !== total || previous !== state.target.hash || !state.witnessed)
      return bad("末尾または独立保存済みの地点が一致しません");
    // Recheck the independent service at completion as well as at the start.
    const currentWitness = point.parse(await options.witness());
    if (currentWitness.seq < state.witness.seq || currentWitness.seq > total ||
        await reader.hashAt(currentWitness.seq) !== currentWitness.hash ||
        (currentWitness.seq === state.witness.seq && currentWitness.hash !== state.witness.hash))
      return bad("独立保存先と一致しません");
    if (!same(await reader.head()) || !same(await reader.latest()))
      return bad("確認中に監査記録の末尾が変わりました。最初から確認してください。");
    return { ok: true, complete: true, checked, total, startedAtMs, startsAtSeq: 1,
      headHash: previous, witnessSeq: currentWitness.seq };
  } catch {
    // Invalid/expired cursor, unavailable witness/DB and unsupported hash
    // versions all remain incomplete. Do not expose credentials or row data.
    return bad("検証を完了できません。通信とログイン状態を確認し、最初から確認してください。");
  }
}
