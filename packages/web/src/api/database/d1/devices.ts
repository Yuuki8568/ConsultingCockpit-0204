/** D1 candidate only. The caller must authenticate the owner and validate Origin. */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { ORPCError } from "@orpc/server";
import * as s from "../schema";
import { operationHash } from "../../../shared/operation-proof";
import { auditHash } from "../../security/audit";
import { atomicCheckedBatch } from "../../../../../../cloudflare/d1/atomic-batch";

const registration = z.object({
  id: z.string().min(4).max(64),
  label: z.string().max(80),
  platform: z.string().max(40),
  userAgent: z.string().max(400).optional(),
  authorization: z.string().uuid().optional(),
});
const target = z.object({
  id: z.string().min(1).max(200),
  authorization: z.string().uuid().optional(),
});
type Principal = { userId: string; sessionId: string };
type Action = "device:register" | "device:revoke" | "device:remove" | "device:unrevoke";
const refuse = (): never => {
  throw new ORPCError("CONFLICT", {
    message: "端末または本人確認の状態が変わりました。再確認してください。",
  });
};

export async function mutateDeviceD1(d1: D1Database, p: Principal, action: Action, raw: unknown) {
  const input = action === "device:register" ? registration.parse(raw) : target.parse(raw);
  const uid = p.userId,
    sid = p.sessionId,
    q = drizzle(d1, { schema: s });
  const [[binding], [device], [head], [tail]] = await q.batch([
    q.select().from(s.deviceSession).where(eq(s.deviceSession.sessionId, sid)),
    q.select().from(s.device).where(eq(s.device.id, input.id)),
    q.select().from(s.auditHead).where(eq(s.auditHead.userId, uid)),
    q
      .select()
      .from(s.auditEvent)
      .where(eq(s.auditEvent.userId, uid))
      .orderBy(desc(s.auditEvent.seq))
      .limit(1),
  ]);
  if (binding?.userId !== undefined && binding.userId !== uid) refuse();
  if (device && device.userId !== uid) refuse();
  if (action === "device:register") {
    if (binding && binding.deviceId !== input.id) refuse();
    if (device?.revokedAtMs != null) refuse();
  } else if (!binding || !device) refuse();
  if (
    (head?.seq ?? 0) !== (tail?.seq ?? 0) ||
    (head?.hash ?? "GENESIS") !== (tail?.hash ?? "GENESIS")
  )
    throw Error("Audit head mismatch");
  const ops: { statement: D1PreparedStatement; expectedChanges: number }[] = [];
  const add = (sql: string, args: unknown[], expectedChanges = 1) =>
    ops.push({ statement: d1.prepare(sql).bind(...args), expectedChanges });
  // Check session expiry and the previously observed binding inside the SAME write batch.
  add(
    `UPDATE session SET updated_at=updated_at WHERE id=? AND user_id=? AND expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)
 AND (SELECT count(*) FROM device_session WHERE session_id=?)=?
 AND (? IS NULL OR EXISTS(SELECT 1 FROM device_session b JOIN device d ON d.id=b.device_id AND d.user_id=b.user_id WHERE b.session_id=? AND b.user_id=? AND b.device_id=? AND d.revoked_at_ms IS NULL))`,
    [
      sid,
      uid,
      sid,
      binding ? 1 : 0,
      binding?.deviceId ?? null,
      sid,
      uid,
      binding?.deviceId ?? null,
    ],
  );
  // Bound heartbeat is safe without another prompt; all binding/state changes need a one-use proof.
  if (action !== "device:register" || !binding) {
    if (!input.authorization) throw new ORPCError("UNAUTHORIZED");
    add(
      `DELETE FROM step_up_ticket WHERE id=? AND user_id=? AND session_id=? AND action=? AND payload_hash=? AND expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)`,
      [input.authorization, uid, sid, action, await operationHash(input)],
    );
  }
  const now = Date.now();
  if (action === "device:register") {
    const r = registration.parse(input);
    if (device)
      add(
        "UPDATE device SET label=?,user_agent=?,last_seen_at_ms=? WHERE id=? AND user_id=? AND revoked_at_ms IS NULL",
        [r.label, r.userAgent ?? null, now, r.id, uid],
      );
    else
      add(
        "INSERT INTO device(id,user_id,label,platform,user_agent,created_at_ms,last_seen_at_ms) VALUES (?,?,?,?,?,?,?)",
        [r.id, uid, r.label, r.platform, r.userAgent ?? null, now, now],
      );
    if (!binding)
      add(
        "INSERT INTO device_session(session_id,user_id,device_id,created_at_ms) VALUES (?,?,?,?)",
        [sid, uid, r.id, now],
      );
  } else {
    // CAS the tombstone, including a concurrently changed revocation timestamp.
    add("UPDATE device SET revoked_at_ms=? WHERE id=? AND user_id=? AND revoked_at_ms IS ?", [
      action === "device:unrevoke" ? null : now,
      input.id,
      uid,
      device!.revokedAtMs,
    ]);
    if (action !== "device:unrevoke") {
      // Snapshot every session, guard its cardinality, then delete by immutable ID.
      // A concurrent login/logout makes the whole operation retry without consuming proof.
      const sessions = await q
        .select({ id: s.session.id })
        .from(s.session)
        .where(eq(s.session.userId, uid))
        .limit(101);
      if (sessions.length > 100) throw new ORPCError("PAYLOAD_TOO_LARGE");
      add(
        "UPDATE device SET last_seen_at_ms=last_seen_at_ms WHERE id=? AND user_id=? AND (SELECT count(*) FROM session WHERE user_id=?)=?",
        [input.id, uid, uid, sessions.length],
      );
      for (const item of sessions)
        if (item.id !== sid || binding!.deviceId === input.id)
          add("DELETE FROM session WHERE id=? AND user_id=?", [item.id, uid]);
    }
  }
  const auditNeeded = action !== "device:register" || !binding;
  if (auditNeeded) {
    const event = {
      id: crypto.randomUUID(),
      userId: uid,
      seq: (head?.seq ?? 0) + 1,
      hashVersion: 2,
      action,
      atMs: now,
      deviceId: binding?.deviceId ?? input.id,
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
    const sql = q
      .insert(s.auditEvent)
      .values({ ...event, hash })
      .toSQL();
    add(sql.sql, sql.params);
  }
  try {
    await atomicCheckedBatch(d1, ops);
  } catch {
    refuse();
  }
  return { ok: true, revoked: action === "device:revoke" || action === "device:remove" };
}
