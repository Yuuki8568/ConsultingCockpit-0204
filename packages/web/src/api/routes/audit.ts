import { auditReader, auditVerificationInput, verifyAuditPage } from "../security/audit-verification";
import { witnessHead } from "../security/witness";
import { appendAudit } from "../security/audit";
import { consumeLimit } from "../security/controls";
import { ciphertextInput,ivInput } from "../security/inputs";
import { ORPCError } from "@orpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import * as schema from "../database/schema";
import { authed } from "../middleware/auth";

/**
 * 監査ログ。
 *
 * ハッシュ連鎖
 * ------------------------------------------------------------------
 * 各エントリは hash = SHA256(seq + action + atMs + payloadCiphertext + prevHash)。
 * 1件でも書き換えたり抜いたりすると以降の連鎖が合わなくなる。
 * v2は利用者・端末・IVを含め、時刻とハッシュをサーバーが確定する。
 */

export const audit = {
  /** 直前のエントリ（連鎖をつなぐため） */
  head: authed.handler(async ({ context }) => {
    const [last] = await db
      .select({ seq: schema.auditEvent.seq, hash: schema.auditEvent.hash })
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.userId, context.user.id))
      .orderBy(desc(schema.auditEvent.seq))
      .limit(1);
    return { seq: last?.seq ?? 0, hash: last?.hash ?? "GENESIS" };
  }),

  /** エントリを追記。連鎖が合わない場合は拒否する。 */
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
      if(Boolean(input.payloadCiphertext)!==Boolean(input.payloadIv))throw new ORPCError("BAD_REQUEST");
      const allowed=await db.transaction(tx=>consumeLimit(tx,`audit:${context.user.id}`,1,60,60000));
      if(!allowed)throw new ORPCError("TOO_MANY_REQUESTS");
      return db.transaction(tx=>appendAudit(tx,context.user.id,context.deviceId,`client:${input.action}`,input.payloadCiphertext??null,input.payloadIv??null));
    }),

  list: authed
    .input(
      z.object({
        limit: z.number().int().min(1).max(1000).default(200),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .handler(({ context, input }) =>
      db
        .select()
        .from(schema.auditEvent)
        .where(eq(schema.auditEvent.userId, context.user.id))
        .orderBy(desc(schema.auditEvent.seq))
        .limit(input.limit)
        .offset(input.offset),
    ),

  count: authed.handler(async ({ context }) => {
    const [r] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.userId, context.user.id));
    return { count: Number(r?.n ?? 0) };
  }),

  /** Full verification advances only through authenticated, signed pages. */
  verifyChain: authed.input(auditVerificationInput).handler(({ context, input }) =>
    verifyAuditPage({
      reader: auditReader(db, context.user.id), userId: context.user.id,
      sessionId: context.session.id, backend: "libsql", cursor: input?.cursor,
      witness: () => witnessHead(context.user.id), secret: process.env.BETTER_AUTH_SECRET ?? "",
    }),
  ),

  /**
   * 監査ログの切り詰め。連鎖の整合性を保つため、先頭からの削除しか許さない。
   * （末尾を消せると隠蔽できてしまうため）
   */
  truncateOldest: authed
    .input(z.object({ keepLatest: z.number().int().min(100).max(100000) }))
    .handler(async ():Promise<{deleted:number}>=>{throw new ORPCError("FORBIDDEN",{message:"監査証跡の保護のため履歴の切り詰めは停止しています"});}),
};
