import { ORPCError } from "@orpc/server";
import { sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function consumeLimit(
  tx: Transaction,
  key: string,
  amount: number,
  limit: number,
  windowMs: number,
  now = Date.now(),
) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const [row] = await tx
    .insert(schema.securityCounter)
    .values({ key, windowStart, count: amount })
    .onConflictDoUpdate({
      target: schema.securityCounter.key,
      set: {
        windowStart,
        count: sql`case when ${schema.securityCounter.windowStart} = ${windowStart} then min(${schema.securityCounter.count} + ${amount}, ${limit + 1}) else ${amount} end`,
      },
    })
    .returning({ count: schema.securityCounter.count });
  return row.count <= limit;
}
export async function syncBudget(userId: string, input: unknown, count: number) {
  const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  const allowed = await db.transaction(async (tx) => {
    const requests = await consumeLimit(tx, `sync:requests:${userId}`, 1, 60, 60_000);
    const records = await consumeLimit(tx, `sync:records:${userId}`, count, 120, 60_000);
    const size = await consumeLimit(tx, `sync:bytes:${userId}`, bytes, 8 * 1024 * 1024, 60_000);
    return requests && records && size;
  });
  // Throw after commit, otherwise a rejected attempt would roll back its counter.
  if (!allowed)
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "同期が集中しています。1分ほど待って再試行してください。",
    });
}
export async function archiveRecords(
  tx: Transaction,
  rows: (typeof schema.record.$inferSelect)[],
  vault: typeof schema.vault.$inferSelect,
) {
  if (!rows.length) return;
  await tx.insert(schema.recordRevision).values(
    rows.map((record) => ({
      id: crypto.randomUUID(),
      userId: record.userId,
      recordId: record.id,
      archivedAtMs: Date.now(),
      snapshot: JSON.stringify({ format: 1, record, vault }),
    })),
  );
}
