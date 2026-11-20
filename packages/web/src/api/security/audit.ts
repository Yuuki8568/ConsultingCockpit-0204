import { desc, eq } from "drizzle-orm";
import * as s from "../database/schema";
import type { Transaction } from "./controls";
export async function auditHash(row: {
  hashVersion: number;
  userId: string;
  seq: number;
  action: string;
  atMs: number;
  deviceId: string | null;
  payloadCiphertext: string | null;
  payloadIv: string | null;
  prevHash: string;
}) {
  let text: string;
  if (row.hashVersion === 1)
    text = `${row.seq}|${row.action}|${row.atMs}|${row.payloadCiphertext ?? ""}|${row.prevHash}`;
  else if (row.hashVersion === 2)
    text = JSON.stringify([
      "cockpit-audit-v2",
      row.userId,
      row.seq,
      row.action,
      row.atMs,
      row.deviceId,
      row.payloadCiphertext,
      row.payloadIv,
      row.prevHash,
    ]);
  else throw new Error("Unsupported audit version");
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function appendAudit(
  tx: Transaction,
  uid: string,
  deviceId: string | null,
  action: string,
  ciphertext: string | null = null,
  iv: string | null = null,
) {
  const [last] = await tx
    .select()
    .from(s.auditEvent)
    .where(eq(s.auditEvent.userId, uid))
    .orderBy(desc(s.auditEvent.seq))
    .limit(1);
  const [head] = await tx.select().from(s.auditHead).where(eq(s.auditHead.userId, uid));
  if (
    (head?.seq ?? 0) !== (last?.seq ?? 0) ||
    (head?.hash ?? "GENESIS") !== (last?.hash ?? "GENESIS")
  )
    throw new Error("Audit head mismatch");
  const row = {
    id: crypto.randomUUID(),
    userId: uid,
    seq: (last?.seq ?? 0) + 1,
    hashVersion: 2,
    action,
    atMs: Date.now(),
    deviceId,
    payloadCiphertext: ciphertext,
    payloadIv: iv,
    prevHash: last?.hash ?? "GENESIS",
  };
  const hash = await auditHash(row);
  await tx.insert(s.auditEvent).values({ ...row, hash });
  await tx
    .insert(s.auditHead)
    .values({ userId: uid, seq: row.seq, hash })
    .onConflictDoUpdate({ target: s.auditHead.userId, set: { seq: row.seq, hash } });
  return { seq: row.seq, hash };
}
