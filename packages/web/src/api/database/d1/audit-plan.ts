import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc } from "drizzle-orm";
import * as s from "../schema";
import { auditHash } from "../../security/audit";
/** Compile append-only audit CAS mutations; caller commits with its business mutations. */
export async function compileAuditD1(
  d1: D1Database,
  uid: string,
  deviceId: string | null,
  action: string,
  payloadCiphertext: string | null = null,
  payloadIv: string | null = null,
) {
  const q = drizzle(d1, { schema: s });
  const [[head], [tail]] = await q.batch([
    q.select().from(s.auditHead).where(eq(s.auditHead.userId, uid)),
    q
      .select()
      .from(s.auditEvent)
      .where(eq(s.auditEvent.userId, uid))
      .orderBy(desc(s.auditEvent.seq))
      .limit(1),
  ]);
  if (
    (head?.seq ?? 0) !== (tail?.seq ?? 0) ||
    (head?.hash ?? "GENESIS") !== (tail?.hash ?? "GENESIS")
  )
    throw Error("Audit head mismatch");
  const event = {
    id: crypto.randomUUID(),
    userId: uid,
    seq: (head?.seq ?? 0) + 1,
    hashVersion: 2,
    action,
    atMs: Date.now(),
    deviceId,
    payloadCiphertext,
    payloadIv,
    prevHash: head?.hash ?? "GENESIS",
  };
  const hash = await auditHash(event),
    insert = q
      .insert(s.auditEvent)
      .values({ ...event, hash })
      .toSQL();
  const ops = [
    {
      statement: head
        ? d1
            .prepare("UPDATE audit_head SET seq=?,hash=? WHERE user_id=? AND seq=? AND hash=?")
            .bind(event.seq, hash, uid, head.seq, head.hash)
        : d1
            .prepare("INSERT INTO audit_head(user_id,seq,hash) VALUES (?,?,?)")
            .bind(uid, event.seq, hash),
      expectedChanges: 1,
    },
    { statement: d1.prepare(insert.sql).bind(...insert.params), expectedChanges: 1 },
  ];
  return { ops, seq: event.seq, hash };
}

export async function auditPlanD1(
  d1: D1Database,
  uid: string,
  deviceId: string | null,
  action: string,
) {
  return (await compileAuditD1(d1, uid, deviceId, action)).ops;
}
