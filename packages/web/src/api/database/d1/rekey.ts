/** Atomic D1 rekey candidate. No production route imports this module. */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull, sql, desc } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as s from "../schema";
import { rekeyInput } from "../../security/rekey-input";
import { operationHash } from "../../../shared/operation-proof";
import { auditHash } from "../../security/audit";
import { atomicCheckedBatch } from "../../../../../../cloudflare/d1/atomic-batch";
import type { SyncPrincipal } from "./sync";
const fail = (): never => {
  throw new ORPCError("CONFLICT", {
    message: "鍵・端末・データまたは本人確認が変更されました。再確認してください。",
  });
};
export async function rekeyD1(d1: D1Database, p: SyncPrincipal, raw: unknown) {
  const input = rekeyInput.parse(raw),
    uid = p.userId,
    q = drizzle(d1, { schema: s });
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 4 * 1024 * 1024)
    throw new ORPCError("PAYLOAD_TOO_LARGE");
  if (!input.authorization) throw new ORPCError("UNAUTHORIZED");
  const sizeGate = sql`(SELECT coalesce(sum(length(ciphertext)+length(iv)),0) FROM record WHERE user_id=${uid} AND deleted_at IS NULL) <= 16777216`;
  const [[v], rows, [identity], [head], [tail], [size]] = await q.batch([
    q.select().from(s.vault).where(eq(s.vault.userId, uid)),
    q
      .select()
      .from(s.record)
      .where(and(eq(s.record.userId, uid), isNull(s.record.deletedAt), sizeGate))
      .limit(1001),
    q.select().from(s.writeIdentity).where(eq(s.writeIdentity.userId, uid)),
    q.select().from(s.auditHead).where(eq(s.auditHead.userId, uid)),
    q
      .select()
      .from(s.auditEvent)
      .where(eq(s.auditEvent.userId, uid))
      .orderBy(desc(s.auditEvent.seq))
      .limit(1),
    q
      .select({
        n: sql<number>`count(*)`,
        bytes: sql<number>`coalesce(sum(length(ciphertext)+length(iv)),0)`,
      })
      .from(s.record)
      .where(and(eq(s.record.userId, uid), isNull(s.record.deletedAt))),
  ]);
  if (!v) throw new ORPCError("NOT_FOUND");
  if (size.n !== rows.length || size.bytes > 16777216 || rows.length > 1000)
    throw new ORPCError("PAYLOAD_TOO_LARGE");
  if (
    (head?.seq ?? 0) !== (tail?.seq ?? 0) ||
    (head?.hash ?? "GENESIS") !== (tail?.hash ?? "GENESIS")
  )
    throw Error("Audit head mismatch");
  const retry =
    v.generation === input.expectedGeneration + 1 &&
    v.kdfSalt === input.kdfSalt &&
    v.verifierCiphertext === input.verifierCiphertext &&
    v.verifierIv === input.verifierIv;
  if (!retry && v.generation !== input.expectedGeneration) fail();
  const incoming = new Map(input.records.map((r) => [r.id, r]));
  if (
    !retry &&
    (incoming.size !== input.records.length ||
      incoming.size !== rows.length ||
      rows.some((r) => incoming.get(r.id)?.baseSeq !== r.seq))
  )
    fail();
  const ops: { statement: D1PreparedStatement; expectedChanges: number }[] = [];
  const add = (query: { toSQL(): { sql: string; params: unknown[] } }, expectedChanges = 1) => {
    const x = query.toSQL();
    ops.push({ statement: d1.prepare(x.sql).bind(...x.params), expectedChanges });
  };
  const rawAdd = (query: string, args: unknown[]) =>
    ops.push({ statement: d1.prepare(query).bind(...args), expectedChanges: 1 });
  rawAdd(
    `UPDATE device SET last_seen_at_ms=? WHERE id=? AND user_id=? AND revoked_at_ms IS NULL
 AND EXISTS(SELECT 1 FROM session WHERE id=? AND user_id=? AND expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER))
 AND EXISTS(SELECT 1 FROM device_session WHERE session_id=? AND user_id=? AND device_id=?)
 AND EXISTS(SELECT 1 FROM vault WHERE user_id=? AND generation=? AND kdf_salt=? AND verifier_ciphertext=? AND verifier_iv=?)
 AND (SELECT count(*) FROM record WHERE user_id=? AND deleted_at IS NULL)=?
 AND (SELECT count(*) FROM write_identity WHERE user_id=?)=?`,
    [
      Date.now(),
      p.deviceId,
      uid,
      p.sessionId,
      uid,
      p.sessionId,
      uid,
      p.deviceId,
      uid,
      v.generation,
      v.kdfSalt,
      v.verifierCiphertext,
      v.verifierIv,
      uid,
      rows.length,
      uid,
      identity ? 1 : 0,
    ],
  );
  rawAdd(
    `DELETE FROM step_up_ticket WHERE id=? AND user_id=? AND session_id=? AND action='vault:rekey' AND payload_hash=? AND expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)`,
    [input.authorization, uid, p.sessionId, await operationHash(input)],
  );
  if (!retry) {
    if (identity) {
      if (!input.writeKey || identity.version !== input.writeKey.expectedVersion) fail();
      add(
        q
          .update(s.writeIdentity)
          .set({
            privateCiphertext: input.writeKey!.privateCiphertext,
            privateIv: input.writeKey!.privateIv,
            generation: v.generation + 1,
            version: identity.version + 1,
          })
          .where(
            and(
              eq(s.writeIdentity.userId, uid),
              eq(s.writeIdentity.version, identity.version),
              eq(s.writeIdentity.generation, v.generation),
              eq(s.writeIdentity.publicKey, identity.publicKey),
            ),
          ),
      );
    }
    for (const row of rows) {
      const next = incoming.get(row.id)!;
      add(
        q
          .insert(s.recordRevision)
          .values({
            id: crypto.randomUUID(),
            userId: uid,
            recordId: row.id,
            archivedAtMs: Date.now(),
            snapshot: JSON.stringify({ format: 1, record: row, vault: v }),
          }),
      );
      add(
        q
          .update(s.record)
          .set({ ciphertext: next.ciphertext, iv: next.iv })
          .where(
            and(
              eq(s.record.userId, uid),
              eq(s.record.id, row.id),
              eq(s.record.seq, row.seq),
              isNull(s.record.deletedAt),
            ),
          ),
      );
    }
    add(
      q
        .update(s.vault)
        .set({
          kdfSalt: input.kdfSalt,
          kdfIterations: input.kdfIterations,
          verifierCiphertext: input.verifierCiphertext,
          verifierIv: input.verifierIv,
          generation: v.generation + 1,
          updatedAtMs: Date.now(),
        })
        .where(and(eq(s.vault.userId, uid), eq(s.vault.generation, v.generation))),
    );
    const event = {
      id: crypto.randomUUID(),
      userId: uid,
      seq: (head?.seq ?? 0) + 1,
      hashVersion: 2,
      action: "vault:rekey",
      atMs: Date.now(),
      deviceId: p.deviceId,
      payloadCiphertext: null,
      payloadIv: null,
      prevHash: head?.hash ?? "GENESIS",
    };
    const hash = await auditHash(event);
    if (head)
      add(
        q
          .update(s.auditHead)
          .set({ seq: event.seq, hash })
          .where(
            and(
              eq(s.auditHead.userId, uid),
              eq(s.auditHead.seq, head.seq),
              eq(s.auditHead.hash, head.hash),
            ),
          ),
      );
    else add(q.insert(s.auditHead).values({ userId: uid, seq: event.seq, hash }));
    add(q.insert(s.auditEvent).values({ ...event, hash }));
  }
  try {
    await atomicCheckedBatch(d1, ops);
  } catch {
    fail();
  }
  return {
    ok: true,
    generation: retry ? v.generation : v.generation + 1,
    reEncrypted: input.records.length,
  };
}
