import { witnessHead } from "../security/witness";
import { appendAudit,auditHash } from "../security/audit";
import { consumeLimit } from "../security/controls";
import { ciphertextInput,ivInput } from "../security/inputs";
import { ORPCError } from "@orpc/server";
import { asc, desc, eq, sql } from "drizzle-orm";
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

  /** ハッシュ連鎖の全件検証。改ざん・欠落を検出する。 */
  verifyChain: authed.handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.userId, context.user.id))
      .orderBy(asc(schema.auditEvent.seq));
    if (rows.length === 0) {
      return { ok: false as const, checked: 0, reason:"独立保存先との照合が未完了です", startsAtSeq: 0 };
    }
    // 先頭を切り詰めた（truncateOldest）場合、残っている最小の通し番号から始まる。
    // そのため 1 からではなく、実際に残っている先頭を起点にして数える。
    // 起点より前は残っていないので、そこから先の連なりだけを確かめる。
    const startsAtSeq = rows[0]!.seq;
    let prevHash = "GENESIS";
    let expectedSeq = 1;
    for (const r of rows) {
      if (r.seq !== expectedSeq) {
        return {
          ok: false as const,
          brokenAtSeq: r.seq,
          reason: `通し番号が飛んでいます（期待 ${expectedSeq} / 実際 ${r.seq}）`,
          checked: rows.length,
          startsAtSeq,
        };
      }
      if (r.prevHash !== prevHash) {
        return {
          ok: false as const,
          brokenAtSeq: r.seq,
          reason: "直前ハッシュが一致しません",
          checked: rows.length,
          startsAtSeq,
        };
      }
      const h = await auditHash(r);
      if (h !== r.hash) {
        return {
          ok: false as const,
          brokenAtSeq: r.seq,
          reason: "内容とハッシュが一致しません（改ざんの可能性）",
          checked: rows.length,
          startsAtSeq,
        };
      }
      prevHash = r.hash;
      expectedSeq++;
    }
    const [head]=await db.select().from(schema.auditHead).where(eq(schema.auditHead.userId,context.user.id));
    if(head?.seq!==rows[rows.length-1]!.seq||head?.hash!==prevHash)return {ok:false as const,checked:rows.length,startsAtSeq,reason:"末尾が管理記録と一致しません"};
    try {
      const witness=await witnessHead(context.user.id);
      if(witness.seq===0)return {ok:false as const,checked:rows.length,startsAtSeq,reason:"独立保存先への初回記録を待っています"};
      const anchored=rows.find(r=>r.seq===witness.seq);
      if(!anchored||anchored.hash!==witness.hash)return {ok:false as const,checked:rows.length,startsAtSeq,reason:"独立保存先と一致しません（末尾削除・改変の可能性）"};
      return {ok:true as const,checked:rows.length,startsAtSeq,headHash:prevHash,witnessSeq:witness.seq};
    } catch {return {ok:false as const,checked:rows.length,startsAtSeq,reason:"独立保存先に接続できず検査未完了です"};}
  }),

  /**
   * 監査ログの切り詰め。連鎖の整合性を保つため、先頭からの削除しか許さない。
   * （末尾を消せると隠蔽できてしまうため）
   */
  truncateOldest: authed
    .input(z.object({ keepLatest: z.number().int().min(100).max(100000) }))
    .handler(async ():Promise<{deleted:number}>=>{throw new ORPCError("FORBIDDEN",{message:"監査証跡の保護のため履歴の切り詰めは停止しています"});}),
};
