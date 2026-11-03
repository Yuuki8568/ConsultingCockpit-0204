/** D1 candidate witness publisher. Not attached to the production cron. */
import { and, eq, gt } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import * as s from "../schema";
import { auditHash } from "../../security/audit";
export type WitnessService = { fetch(request: Request): Promise<Response> };
export async function witnessHeadD1(service: WitnessService | undefined, userId: string) {
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
export async function publishWitnessesD1(d1: D1Database, service: WitnessService | undefined) {
  const db = drizzle(d1, { schema: s });
  if (!service) throw new Error("Audit witness unavailable");
  const heads = await db.select().from(s.auditHead).limit(100);
  for (const head of heads) {
    const prior = await witnessHeadD1(service, head.userId);
    if (prior.seq > head.seq) throw new Error("Audit tail missing");
    if (prior.seq) {
      const [row] = await db
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.userId, head.userId), eq(s.auditEvent.seq, prior.seq)));
      if (row?.hash !== prior.hash) throw new Error("Audit checkpoint mismatch");
    }
    const rows = await db
      .select()
      .from(s.auditEvent)
      .where(and(eq(s.auditEvent.userId, head.userId), gt(s.auditEvent.seq, prior.seq)))
      .orderBy(s.auditEvent.seq)
      .limit(1000);
    let seq = prior.seq,
      hash = prior.hash;
    for (const r of rows) {
      if (r.seq !== seq + 1 || r.prevHash !== hash || (await auditHash(r)) !== r.hash)
        throw new Error("Audit chain mismatch");
      seq = r.seq;
      hash = r.hash;
    }
    // The head is read before the page: concurrent appends may extend it, but
    // a short page may never stop before the head we already observed.
    if (seq < head.seq && rows.length < 1000) throw new Error("Audit tail missing");
    const observedHead = rows.find((r) => r.seq === head.seq);
    if (
      (observedHead && observedHead.hash !== head.hash) ||
      (head.seq === prior.seq && head.hash !== prior.hash)
    )
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
