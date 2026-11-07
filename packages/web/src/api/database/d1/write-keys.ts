/** D1 candidate. All entry points require the authenticated owner principal. */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { ORPCError } from "@orpc/server";
import * as s from "../schema";
import { ciphertextInput, ivInput } from "../../security/inputs";
import { operationHash } from "../../../shared/operation-proof";
import { auditHash } from "../../security/audit";
import { atomicCheckedBatch } from "../../../../../../cloudflare/d1/atomic-batch";
import { sessionGuard, consumeD1Limit, type AuthPrincipal } from "./authorization";
const registration = z.object({
  publicKey: z
    .object({
      kty: z.literal("EC"),
      crv: z.literal("P-256"),
      x: z.string().regex(/^[\w-]{43}$/),
      y: z.string().regex(/^[\w-]{43}$/),
    })
    .strict(),
  privateCiphertext: ciphertextInput,
  privateIv: ivInput,
  generation: z.number().int().positive(),
  expectedVersion: z.number().int().nonnegative(),
  authorization: z.string().uuid().optional(),
});
export async function registerWriteKeyD1(d1: D1Database, p: AuthPrincipal, raw: unknown) {
  const input = registration.parse(raw),
    q = drizzle(d1, { schema: s }),
    uid = p.userId;
  if (!input.authorization) throw new ORPCError("UNAUTHORIZED");
  try {
    await crypto.subtle.importKey(
      "jwk",
      input.publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    throw new ORPCError("BAD_REQUEST");
  }
  const [[old], [head], [tail], [binding]] = await q.batch([
    q.select().from(s.writeIdentity).where(eq(s.writeIdentity.userId, uid)),
    q.select().from(s.auditHead).where(eq(s.auditHead.userId, uid)),
    q
      .select()
      .from(s.auditEvent)
      .where(eq(s.auditEvent.userId, uid))
      .orderBy(desc(s.auditEvent.seq))
      .limit(1),
    q.select().from(s.deviceSession).where(eq(s.deviceSession.sessionId, p.sessionId)),
  ]);
  if ((old?.version ?? 0) !== input.expectedVersion) throw new ORPCError("CONFLICT");
  if (
    (head?.seq ?? 0) !== (tail?.seq ?? 0) ||
    (head?.hash ?? "GENESIS") !== (tail?.hash ?? "GENESIS")
  )
    throw Error("Audit head mismatch");
  const ops: { statement: D1PreparedStatement; expectedChanges: number }[] = [sessionGuard(d1, p)];
  const add = (sql: string, args: unknown[]) =>
    ops.push({ statement: d1.prepare(sql).bind(...args), expectedChanges: 1 });
  add(
    "DELETE FROM step_up_ticket WHERE id=? AND user_id=? AND session_id=? AND action=? AND payload_hash=? AND expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER) AND EXISTS(SELECT 1 FROM vault WHERE user_id=? AND generation=?)",
    [
      input.authorization,
      uid,
      p.sessionId,
      "write-key:register",
      await operationHash(input),
      uid,
      input.generation,
    ],
  );
  const values = {
    userId: uid,
    publicKey: JSON.stringify(input.publicKey),
    privateCiphertext: input.privateCiphertext,
    privateIv: input.privateIv,
    generation: input.generation,
    version: input.expectedVersion + 1,
  };
  if (old)
    add(
      "UPDATE write_identity SET public_key=?,private_ciphertext=?,private_iv=?,generation=?,version=? WHERE user_id=? AND version=? AND public_key=?",
      [
        values.publicKey,
        values.privateCiphertext,
        values.privateIv,
        values.generation,
        values.version,
        uid,
        old.version,
        old.publicKey,
      ],
    );
  else {
    const x = q.insert(s.writeIdentity).values(values).toSQL();
    add(x.sql, x.params);
  }
  const event = {
    id: crypto.randomUUID(),
    userId: uid,
    seq: (head?.seq ?? 0) + 1,
    hashVersion: 2,
    action: "write-key:register",
    atMs: Date.now(),
    deviceId: binding?.deviceId ?? null,
    payloadCiphertext: null,
    payloadIv: null,
    prevHash: head?.hash ?? "GENESIS",
  };
  const hash = await auditHash(event);
  if (head)
    add("UPDATE audit_head SET seq=?,hash=? WHERE user_id=? AND seq=? AND hash=?", [
      event.seq,
      hash,
      uid,
      head.seq,
      head.hash,
    ]);
  else add("INSERT INTO audit_head(user_id,seq,hash) VALUES (?,?,?)", [uid, event.seq, hash]);
  const x = q
    .insert(s.auditEvent)
    .values({ ...event, hash })
    .toSQL();
  add(x.sql, x.params);
  try {
    await atomicCheckedBatch(d1, ops);
  } catch {
    throw new ORPCError("CONFLICT");
  }
  return { ok: true };
}
export async function writeChallengeD1(d1: D1Database, p: AuthPrincipal, raw: unknown) {
  const input = z
    .object({
      deviceId: z.string().min(4).max(64),
      payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .parse(raw);
  await consumeD1Limit(d1, `write-challenge:${p.userId}`, 60, 60000);
  const value = {
    id: crypto.randomUUID(),
    userId: p.userId,
    sessionId: p.sessionId,
    payloadHash: input.payloadHash,
    expiresAtMs: Date.now() + 60000,
  };
  const statement = d1
    .prepare(`INSERT INTO security_challenge(id,user_id,session_id,kind,challenge,action,payload_hash,expires_at_ms)
 SELECT ?,?,?,'write','','sync:push',?,? WHERE EXISTS(SELECT 1 FROM device_session WHERE session_id=? AND user_id=? AND device_id=?)`)
    .bind(
      value.id,
      value.userId,
      value.sessionId,
      value.payloadHash,
      value.expiresAtMs,
      p.sessionId,
      p.userId,
      input.deviceId,
    );
  try {
    await atomicCheckedBatch(d1, [sessionGuard(d1, p), { statement, expectedChanges: 1 }]);
  } catch {
    throw new ORPCError("FORBIDDEN");
  }
  return value;
}
