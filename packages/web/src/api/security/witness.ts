import { and, eq, gt, lte } from "drizzle-orm";
import { db, databaseContext } from "../database";
import * as s from "../database/schema";
import { auditHash } from "./audit";
import { selectWitnessPage, witnessPayloadBytes, witnessPageSizeGate, WITNESS_PAGE_ROWS } from "./witness-page";
export type WitnessService = { fetch(request: Request): Promise<Response> };
export async function witnessHead(userId: string) {
  const service = databaseContext.getStore()?.witness;
  if (!service) throw new Error("Audit witness unavailable");
  const res = await service.fetch(
    new Request(`https://witness/head?user=${encodeURIComponent(userId)}`),
  );
  if (!res.ok) throw new Error("Audit witness unavailable");
  const value = (await res.json()) as { seq: number; hash: string };
  if (
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0 ||
    typeof value.hash !== "string" ||
    !(value.hash === "GENESIS" || /^[0-9a-f]{64}$/.test(value.hash))
  )
    throw new Error("Invalid witness response");
  return value;
}
export async function publishWitnesses() {
  const service = databaseContext.getStore()?.witness;
  if (!service) throw new Error("Audit witness unavailable");
  const heads = await db.select().from(s.auditHead).limit(100);
  for (const head of heads) {
    const prior = await witnessHead(head.userId);
    if (prior.seq > head.seq) throw new Error("Audit tail missing");
    // The anchor only needs its hash: fetching an already witnessed encrypted
    // payload on every cron tick adds transfer without strengthening this check.
    // Keep an unchanged tick to two DB calls; only a nonempty page loads payloads.
    const [[anchor], metadata] = await db.batch([
      db
        .select({ hash: s.auditEvent.hash })
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.userId, head.userId), eq(s.auditEvent.seq, prior.seq))),
      db
        .select({ seq: s.auditEvent.seq, hash: s.auditEvent.hash, bytes: witnessPayloadBytes })
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.userId, head.userId), gt(s.auditEvent.seq, prior.seq)))
        .orderBy(s.auditEvent.seq)
        .limit(WITNESS_PAGE_ROWS + 1),
    ]);
    if (prior.seq && anchor?.hash !== prior.hash)
      throw new Error("Audit checkpoint mismatch");
    const page = selectWitnessPage(metadata, prior.seq);
    const rows = page.rows.length ? await db.select().from(s.auditEvent).where(and(
      eq(s.auditEvent.userId, head.userId), gt(s.auditEvent.seq, prior.seq),
      lte(s.auditEvent.seq, page.cursor), witnessPageSizeGate(head.userId, prior.seq, page.cursor),
    )).orderBy(s.auditEvent.seq).limit(WITNESS_PAGE_ROWS) : [];
    if (rows.length !== page.rows.length || rows.some((r, i) =>
      r.seq !== page.rows[i].seq || r.hash !== page.rows[i].hash))
      throw new Error("Audit page changed during verification");
    let seq = prior.seq,
      hash = prior.hash;
    for (const r of rows) {
      if (r.seq !== seq + 1 || r.prevHash !== hash || (await auditHash(r)) !== r.hash)
        throw new Error("Audit chain mismatch");
      seq = r.seq;
      hash = r.hash;
    }
    // The head is read before the page: concurrent appends may extend it, but
    // an exhausted metadata page cannot stop before the head already observed.
    if (seq < head.seq && !page.hasMore) throw new Error("Audit tail missing");
    const observedHead = rows.find(r => r.seq === head.seq);
    if ((observedHead && observedHead.hash !== head.hash) ||
        (head.seq === prior.seq && head.hash !== prior.hash))
      throw new Error("Audit head mismatch");
    if (seq === prior.seq) continue;
    const res = await service.fetch(
      new Request("https://witness/checkpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: head.userId,
          seq,
          hash,
          previousSeq: prior.seq,
          previousHash: prior.hash,
        }),
      }),
    );
    if (!res.ok) throw new Error("Audit publication failed");
  }
}
