import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc, sql, and } from "drizzle-orm";
import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { base } from "../../__core/app";
import { authenticateD1 } from "./auth";
import { sessionGuard, consumeD1Limit } from "./authorization";
import { compileAuditD1 } from "./audit-plan";
import { atomicCheckedBatch } from "../../../../../../cloudflare/d1/atomic-batch";
import { auditHash } from "../../security/audit";
import { ciphertextInput, ivInput } from "../../security/inputs";
import { witnessHeadD1, type WitnessService } from "./witness";
import * as s from "../schema";
export function createD1Audit(d1: D1Database, witness?: WitnessService) {
  const q = drizzle(d1, { schema: s });
  const authed = base.use(async ({ context, next }) =>
    next({ context: await authenticateD1(d1, context.headers) }),
  );
  return {
    head: authed.handler(async ({ context }) => {
      const [r] = await q
        .select({ seq: s.auditEvent.seq, hash: s.auditEvent.hash })
        .from(s.auditEvent)
        .where(eq(s.auditEvent.userId, context.user.id))
        .orderBy(desc(s.auditEvent.seq))
        .limit(1);
      return r ?? { seq: 0, hash: "GENESIS" };
    }),
    append: authed
      .input(
        z.object({
          action: z.string().min(1).max(60),
          atMs: z.number().int(),
          payloadCiphertext: ciphertextInput.optional(),
          payloadIv: ivInput.optional(),
          deviceId: z.string().max(64).optional(),
        }),
      )
      .handler(async ({ context, input }) => {
        if (Boolean(input.payloadCiphertext) !== Boolean(input.payloadIv))
          throw new ORPCError("BAD_REQUEST");
        await consumeD1Limit(d1, `audit:${context.user.id}`, 60, 60000);
        const plan = await compileAuditD1(
          d1,
          context.user.id,
          context.deviceId,
          `client:${input.action}`,
          input.payloadCiphertext ?? null,
          input.payloadIv ?? null,
        );
        await atomicCheckedBatch(d1, [
          sessionGuard(d1, { userId: context.user.id, sessionId: context.session.id }),
          ...plan.ops,
        ]);
        return { seq: plan.seq, hash: plan.hash };
      }),
    list: authed
      .input(
        z.object({
          limit: z.number().int().min(1).max(1000).default(200),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .handler(async ({ context, input }) => {
        // Audit payloads can each approach 1MiB. Refuse an overlarge page before loading it.
        const size = await d1
          .prepare(
            "SELECT coalesce(sum(length(payload_ciphertext)),0) bytes FROM (SELECT payload_ciphertext FROM audit_event WHERE user_id=? ORDER BY seq DESC LIMIT ? OFFSET ?)",
          )
          .bind(context.user.id, input.limit, input.offset)
          .first<{ bytes: number }>();
        if (!size || size.bytes > 16777216) throw new ORPCError("PAYLOAD_TOO_LARGE");
        return q
          .select()
          .from(s.auditEvent)
          .where(
            and(
              eq(s.auditEvent.userId, context.user.id),
              sql`(SELECT coalesce(sum(length(payload_ciphertext)),0) FROM (SELECT payload_ciphertext FROM audit_event WHERE user_id=${context.user.id} ORDER BY seq DESC LIMIT ${input.limit} OFFSET ${input.offset}))<=16777216`,
            ),
          )
          .orderBy(desc(s.auditEvent.seq))
          .limit(input.limit)
          .offset(input.offset);
      }),
    count: authed.handler(async ({ context }) => {
      const [r] = await q
        .select({ n: sql<number>`count(*)` })
        .from(s.auditEvent)
        .where(eq(s.auditEvent.userId, context.user.id));
      return { count: Number(r.n) };
    }),
    verifyChain: authed.handler(async ({ context }) => {
      const uid = context.user.id;
      const [[size], [head], rows] = await q.batch([
        q
          .select({
            n: sql<number>`count(*)`,
            bytes: sql<number>`coalesce(sum(length(payload_ciphertext)),0)`,
          })
          .from(s.auditEvent)
          .where(eq(s.auditEvent.userId, uid)),
        q.select().from(s.auditHead).where(eq(s.auditHead.userId, uid)),
        q
          .select()
          .from(s.auditEvent)
          .where(
            and(
              eq(s.auditEvent.userId, uid),
              sql`(SELECT coalesce(sum(length(payload_ciphertext)),0) FROM audit_event WHERE user_id=${uid})<=16777216`,
            ),
          )
          .orderBy(s.auditEvent.seq)
          .limit(10001),
      ]);
      const bad = (reason: string) => ({
        ok: false as const,
        checked: rows.length,
        startsAtSeq: rows[0]?.seq ?? 0,
        reason,
      });
      if (size.n !== rows.length || size.n > 10000 || size.bytes > 16777216)
        return bad("検証可能な件数・容量を超えています。ページ単位の検証が必要です");
      if (!rows.length) return bad("独立保存先との照合が未完了です");
      let seq = 0,
        hash = "GENESIS";
      for (const r of rows) {
        if (r.seq !== seq + 1 || r.prevHash !== hash || (await auditHash(r)) !== r.hash)
          return bad("監査記録の連鎖が一致しません");
        seq = r.seq;
        hash = r.hash;
      }
      if (head?.seq !== seq || head?.hash !== hash) return bad("末尾が管理記録と一致しません");
      try {
        const anchored = await witnessHeadD1(witness, uid);
        if (!anchored.seq) return bad("独立保存先への初回記録を待っています");
        if (rows.find((r) => r.seq === anchored.seq)?.hash !== anchored.hash)
          return bad("独立保存先と一致しません");
        return {
          ok: true as const,
          checked: rows.length,
          startsAtSeq: rows[0].seq,
          headHash: hash,
          witnessSeq: anchored.seq,
        };
      } catch {
        return bad("独立保存先に接続できず検査未完了です");
      }
    }),
    truncateOldest: authed.input(z.unknown()).handler(() => {
      throw new ORPCError("FORBIDDEN");
    }),
  };
}
