/** D1 cutover candidate. Not connected to the production router or bindings. */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, desc, gt, inArray, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as s from "../schema";
import { syncInput, type SyncInput } from "../../security/sync-input";
import { operationHash, signingMessage } from "../../../shared/operation-proof";
import { auditHash } from "../../security/audit";
import { MAX_SYNC_PAGE_ROWS, SYNC_ROW_OVERHEAD, selectSyncPage } from "../../../shared/sync-page";
import { atomicCheckedBatch } from "../../../../../../cloudflare/d1/atomic-batch";

export type SyncPrincipal = { userId: string; sessionId: string; deviceId: string };
const fail = (
  code:
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "CONFLICT"
    | "NOT_FOUND"
    | "TOO_MANY_REQUESTS"
    | "PAYLOAD_TOO_LARGE",
): never => {
  throw new ORPCError(code);
};
// Keep the existing whole-vault safety envelope until key rotation is paged.
const MAX_VAULT_ROWS = 1000;
const MAX_VAULT_BYTES = 16 * 1024 * 1024;
const sqlNow = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

async function budget(d1: D1Database, uid: string, input: SyncInput) {
  const now = Date.now(),
    window = Math.floor(now / 60000) * 60000;
  const amounts = [
    1,
    input.records.length,
    new TextEncoder().encode(JSON.stringify(input)).byteLength,
  ];
  const limits = [60, 120, 8 * 1024 * 1024],
    names = ["requests", "records", "bytes"];
  const result = await d1.batch<{ count: number }>(
    amounts.map((amount, i) =>
      d1
        .prepare(`INSERT INTO security_counter(key,window_start,count) VALUES (?,?,?)
 ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN security_counter.window_start=excluded.window_start THEN min(security_counter.count+excluded.count,?) ELSE excluded.count END RETURNING count`)
        .bind(`sync:${names[i]}:${uid}`, window, amount, limits[i] + 1),
    ),
  );
  if (result.some((r, i) => Number(r.results[0]?.count) > limits[i])) fail("TOO_MANY_REQUESTS");
}

/** Caller authenticates the account; session/device authorization is rechecked in SQL at commit. */
export async function pushD1(d1: D1Database, principal: SyncPrincipal, raw: unknown) {
  const input = syncInput.parse(raw),
    uid = principal.userId;
  if (principal.deviceId !== input.deviceId) fail("FORBIDDEN");
  if (new Set(input.records.map((r) => r.id)).size !== input.records.length) fail("CONFLICT");
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 4 * 1024 * 1024)
    fail("PAYLOAD_TOO_LARGE");
  const q = drizzle(d1, { schema: s });
  const snapshot = await q.batch([
    q.select().from(s.vault).where(eq(s.vault.userId, uid)),
    q
      .select()
      .from(s.device)
      .where(and(eq(s.device.userId, uid), eq(s.device.id, input.deviceId))),
    q.select().from(s.deviceSession).where(eq(s.deviceSession.sessionId, principal.sessionId)),
    q
      .select()
      .from(s.session)
      .where(and(eq(s.session.id, principal.sessionId), eq(s.session.userId, uid))),
    q.select().from(s.writeIdentity).where(eq(s.writeIdentity.userId, uid)),
    q
      .select()
      .from(s.securityChallenge)
      .where(eq(s.securityChallenge.id, input.proof?.id ?? "")),
    q
      .select()
      .from(s.record)
      .where(
        and(
          eq(s.record.userId, uid),
          inArray(
            s.record.id,
            input.records.map((r) => r.id),
          ),
        ),
      ),
    q.select().from(s.auditHead).where(eq(s.auditHead.userId, uid)),
    q
      .select({ seq: s.auditEvent.seq, hash: s.auditEvent.hash })
      .from(s.auditEvent)
      .where(eq(s.auditEvent.userId, uid))
      .orderBy(desc(s.auditEvent.seq))
      .limit(1),
    q
      .select({
        seq: sql<number>`coalesce(max(seq),0)`,
        n: sql<number>`count(*)`,
        bytes: sql<number>`coalesce(sum(length(ciphertext)+length(iv)),0)`,
      })
      .from(s.record)
      .where(eq(s.record.userId, uid)),
    q
      .select({
        id: s.record.id,
        seq: s.record.seq,
        bytes: sql<number>`length(ciphertext)+length(iv)`,
      })
      .from(s.record)
      .where(and(eq(s.record.userId, uid), gt(s.record.seq, input.since)))
      .orderBy(s.record.seq)
      .limit(MAX_SYNC_PAGE_ROWS + 1),
  ]);
  const [
    [v],
    [device],
    [bound],
    [session],
    [identity],
    [challenge],
    records,
    [head],
    [tail],
    [maxRecord],
    pageMetadata,
  ] = snapshot;
  if (
    !device ||
    device.revokedAtMs ||
    bound?.userId !== uid ||
    bound.deviceId !== input.deviceId ||
    !session ||
    session.expiresAt.getTime() <= Date.now()
  )
    fail("FORBIDDEN");
  await budget(d1, uid, input); // Rejected attempts persist independently of the business transaction.
  if (!v) fail("NOT_FOUND");
  if (v.generation !== input.generation) fail("CONFLICT");
  if (
    maxRecord.n > MAX_VAULT_ROWS ||
    maxRecord.bytes + maxRecord.n * SYNC_ROW_OVERHEAD > MAX_VAULT_BYTES
  )
    fail("PAYLOAD_TOO_LARGE");
  if (
    (head?.seq ?? 0) !== (tail?.seq ?? 0) ||
    (head?.hash ?? "GENESIS") !== (tail?.hash ?? "GENESIS")
  )
    throw Error("Audit head mismatch");
  if (input.records.length) {
    if (
      !input.proof ||
      !identity ||
      identity.generation !== input.generation ||
      !challenge ||
      challenge.kind !== "write" ||
      challenge.action !== "sync:push" ||
      challenge.userId !== uid ||
      challenge.sessionId !== principal.sessionId ||
      challenge.expiresAtMs <= Date.now() ||
      challenge.payloadHash !== (await operationHash(input))
    )
      fail("UNAUTHORIZED");
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        JSON.parse(identity.publicKey),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      const message = signingMessage({
        id: challenge.id,
        userId: uid,
        sessionId: principal.sessionId,
        payloadHash: challenge.payloadHash,
        expiresAtMs: challenge.expiresAtMs,
      });
      const signature = Uint8Array.from(atob(input.proof!.signature), (c) => c.charCodeAt(0));
      if (
        !(await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          key,
          signature,
          new TextEncoder().encode(message),
        ))
      )
        fail("UNAUTHORIZED");
    } catch {
      fail("UNAUTHORIZED");
    }
  }
  const changes: { statement: D1PreparedStatement; expectedChanges: number }[] = [];
  const add = (sql: string, args: unknown[], expectedChanges = 1) =>
    changes.push({ statement: d1.prepare(sql).bind(...args), expectedChanges });
  let page: ReturnType<typeof selectSyncPage>;
  try {
    page = selectSyncPage(pageMetadata, input.since);
  } catch {
    return fail("PAYLOAD_TOO_LARGE");
  }
  const pageQueries = [];
  for (let start = 0; start < page.ids.length; start += 80) {
    pageQueries.push(
      q
        .select()
        .from(s.record)
        .where(
          and(eq(s.record.userId, uid), inArray(s.record.id, page.ids.slice(start, start + 80))),
        ),
    );
  }
  const [firstPageQuery, ...remainingPageQueries] = pageQueries;
  const pageRows = firstPageQuery
    ? (await q.batch([firstPageQuery, ...remainingPageQueries])).flat()
    : [];
  if (pageRows.length !== page.ids.length) fail("CONFLICT");
  const metadataById = new Map(pageMetadata.map((r) => [r.id, r]));
  if (
    pageRows.some(
      (r) =>
        r.seq !== metadataById.get(r.id)?.seq ||
        r.ciphertext.length + r.iv.length !== metadataById.get(r.id)?.bytes,
    )
  )
    fail("CONFLICT");
  const maximum = Number(maxRecord.seq);
  // These guards share the commit transaction with every ciphertext and audit mutation.
  add(
    `UPDATE device SET last_seen_at_ms=? WHERE id=? AND user_id=? AND revoked_at_ms IS NULL
 AND EXISTS(SELECT 1 FROM device_session WHERE session_id=? AND user_id=? AND device_id=?)
 AND EXISTS(SELECT 1 FROM session WHERE id=? AND user_id=? AND expires_at>${sqlNow})
 AND EXISTS(SELECT 1 FROM vault WHERE user_id=? AND generation=? AND kdf_salt=? AND verifier_ciphertext=? AND verifier_iv=?)
 AND (SELECT count(*) FROM record WHERE user_id=?)=?
 AND (SELECT coalesce(max(seq),0) FROM record WHERE user_id=?)=?
 AND coalesce((SELECT seq FROM audit_head WHERE user_id=?),0)=?
 AND coalesce((SELECT hash FROM audit_head WHERE user_id=?),'GENESIS')=?
 AND coalesce((SELECT seq FROM audit_event WHERE user_id=? ORDER BY seq DESC LIMIT 1),0)=?
 AND coalesce((SELECT hash FROM audit_event WHERE user_id=? ORDER BY seq DESC LIMIT 1),'GENESIS')=?`,
    [
      Date.now(),
      input.deviceId,
      uid,
      principal.sessionId,
      uid,
      input.deviceId,
      principal.sessionId,
      uid,
      uid,
      v.generation,
      v.kdfSalt,
      v.verifierCiphertext,
      v.verifierIv,
      uid,
      maxRecord.n,
      uid,
      maximum,
      uid,
      head?.seq ?? 0,
      uid,
      head?.hash ?? "GENESIS",
      uid,
      tail?.seq ?? 0,
      uid,
      tail?.hash ?? "GENESIS",
    ],
  );
  if (input.records.length) {
    add(
      `DELETE FROM security_challenge WHERE id=? AND user_id=? AND session_id=? AND kind='write' AND action='sync:push'
   AND payload_hash=? AND expires_at_ms=? AND expires_at_ms>${sqlNow}
   AND EXISTS(SELECT 1 FROM write_identity WHERE user_id=? AND generation=? AND version=? AND public_key=?)`,
      [
        challenge!.id,
        uid,
        principal.sessionId,
        challenge!.payloadHash,
        challenge!.expiresAtMs,
        uid,
        identity!.generation,
        identity!.version,
        identity!.publicKey,
      ],
    );
  }
  const now = Date.now();
  let nextSeq = Math.max(now, maximum);
  const byId = new Map(records.map((r) => [r.id, { ...r }]));
  const accepted: string[] = [],
    acceptedVersions: Record<string, number> = {};
  const conflicts: {
    id: string;
    serverCiphertext: string;
    serverIv: string;
    serverUpdatedAtMs: number;
    losingSide: "client" | "server";
  }[] = [];
  for (const r of input.records) {
    const old = byId.get(r.id);
    if (!old) {
      if (r.deleted || r.baseSeq !== 0) fail("CONFLICT");
      const seq = ++nextSeq;
      add(
        "INSERT INTO record(id,user_id,type,ciphertext,iv,updated_at_ms,version,deleted_at,device_id,seq) VALUES (?,?,?,?,?,?,1,NULL,?,?)",
        [r.id, uid, r.type, r.ciphertext, r.iv, r.updatedAtMs, input.deviceId, seq],
      );
      byId.set(r.id, {
        id: r.id,
        userId: uid,
        type: r.type,
        ciphertext: r.ciphertext,
        iv: r.iv,
        updatedAtMs: r.updatedAtMs,
        version: 1,
        deletedAt: null,
        deviceId: input.deviceId,
        seq,
      });
      accepted.push(r.id);
      acceptedVersions[r.id] = seq;
    } else if (old.seq === r.baseSeq && old.type === r.type) {
      add(
        "INSERT INTO record_revision(id,user_id,record_id,archived_at_ms,snapshot) VALUES (?,?,?,?,?)",
        [crypto.randomUUID(), uid, r.id, now, JSON.stringify({ format: 1, record: old, vault: v })],
      );
      const seq = ++nextSeq;
      add(
        "UPDATE record SET ciphertext=?,iv=?,updated_at_ms=?,version=version+1,deleted_at=?,device_id=?,seq=? WHERE user_id=? AND id=? AND seq=? AND type=?",
        [
          r.ciphertext,
          r.iv,
          r.updatedAtMs,
          r.deleted ? now : null,
          input.deviceId,
          seq,
          uid,
          r.id,
          old.seq,
          old.type,
        ],
      );
      byId.set(r.id, {
        ...old,
        ciphertext: r.ciphertext,
        iv: r.iv,
        updatedAtMs: r.updatedAtMs,
        version: old.version + 1,
        deletedAt: r.deleted ? now : null,
        deviceId: input.deviceId,
        seq,
      });
      accepted.push(r.id);
      acceptedVersions[r.id] = seq;
    } else if (
      old.ciphertext !== r.ciphertext ||
      old.iv !== r.iv ||
      r.deleted !== (old.deletedAt != null)
    ) {
      conflicts.push({
        id: r.id,
        serverCiphertext: old.ciphertext,
        serverIv: old.iv,
        serverUpdatedAtMs: old.updatedAtMs,
        losingSide: "client",
      });
    } else {
      accepted.push(r.id);
      acceptedVersions[r.id] = old.seq;
    }
  }
  const original = new Map(records.map((r) => [r.id, r]));
  let resultingCount = Number(maxRecord.n),
    resultingBytes = Number(maxRecord.bytes);
  for (const row of byId.values()) {
    const before = original.get(row.id);
    if (!before) resultingCount++;
    resultingBytes +=
      row.ciphertext.length +
      row.iv.length -
      (before ? before.ciphertext.length + before.iv.length : 0);
  }
  if (
    resultingCount > MAX_VAULT_ROWS ||
    resultingBytes + resultingCount * SYNC_ROW_OVERHEAD > MAX_VAULT_BYTES
  )
    fail("PAYLOAD_TOO_LARGE");
  if (accepted.length) {
    const row = {
      id: crypto.randomUUID(),
      userId: uid,
      seq: (head?.seq ?? 0) + 1,
      hashVersion: 2,
      action: "sync:accepted",
      atMs: now,
      deviceId: input.deviceId,
      payloadCiphertext: null,
      payloadIv: null,
      prevHash: head?.hash ?? "GENESIS",
    };
    const hash = await auditHash(row);
    if (head)
      add("UPDATE audit_head SET seq=?,hash=? WHERE user_id=? AND seq=? AND hash=?", [
        row.seq,
        hash,
        uid,
        head.seq,
        head.hash,
      ]);
    else add("INSERT INTO audit_head(user_id,seq,hash) VALUES (?,?,?)", [uid, row.seq, hash]);
    add(
      "INSERT INTO audit_event(id,user_id,seq,action,at_ms,device_id,payload_ciphertext,payload_iv,prev_hash,hash,hash_version) VALUES (?,?,?,?,?,?,NULL,NULL,?,?,2)",
      [row.id, uid, row.seq, row.action, now, input.deviceId, row.prevHash, hash],
    );
  }
  try {
    await atomicCheckedBatch(d1, changes);
  } catch {
    fail("CONFLICT");
  }
  // Use the snapshot page plus committed local writes. Keep the page cursor
  // separate from newer accepted/conflict rows so no unseen delta is skipped.
  const changedById = new Map(pageRows.map((r) => [r.id, byId.get(r.id) ?? r]));
  for (const r of byId.values()) {
    if ((!page.hasMore && r.seq > input.since) || conflicts.some((c) => c.id === r.id))
      changedById.set(r.id, r);
  }
  const changed = [...changedById.values()].sort((a, b) => a.seq - b.seq);
  const cursor = page.hasMore ? page.cursor : Math.max(page.cursor, ...changed.map((r) => r.seq));
  return {
    generation: v.generation,
    accepted,
    acceptedVersions,
    conflicts,
    cursor,
    hasMore: page.hasMore,
    changed: changed.map((c) => ({
      id: c.id,
      type: c.type,
      ciphertext: c.ciphertext,
      iv: c.iv,
      updatedAtMs: c.updatedAtMs,
      version: c.version,
      deleted: c.deletedAt !== null,
      seq: c.seq,
    })),
  };
}
