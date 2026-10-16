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
 * hash はクライアント側で計算して送る（サーバーも同じ式で検証する）。
 */

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function chainInput(e: {
  seq: number;
  action: string;
  atMs: number;
  payloadCiphertext: string | null;
  prevHash: string;
}): string {
  return `${e.seq}|${e.action}|${e.atMs}|${e.payloadCiphertext ?? ""}|${e.prevHash}`;
}

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
        payloadCiphertext: z.string().max(20000).optional(),
        payloadIv: z.string().max(64).optional(),
        deviceId: z.string().max(64).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const uid = context.user.id;
      const [last] = await db
        .select({ seq: schema.auditEvent.seq, hash: schema.auditEvent.hash })
        .from(schema.auditEvent)
        .where(eq(schema.auditEvent.userId, uid))
        .orderBy(desc(schema.auditEvent.seq))
        .limit(1);
      const seq = (last?.seq ?? 0) + 1;
      const prevHash = last?.hash ?? "GENESIS";
      const hash = await sha256Hex(
        chainInput({
          seq,
          action: input.action,
          atMs: input.atMs,
          payloadCiphertext: input.payloadCiphertext ?? null,
          prevHash,
        }),
      );
      await db.insert(schema.auditEvent).values({
        id: crypto.randomUUID(),
        userId: uid,
        seq,
        action: input.action,
        atMs: input.atMs,
        deviceId: input.deviceId ?? null,
        payloadCiphertext: input.payloadCiphertext ?? null,
        payloadIv: input.payloadIv ?? null,
        prevHash,
        hash,
      });
      return { seq, hash };
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
      return { ok: true as const, checked: 0, headHash: "GENESIS", startsAtSeq: 0 };
    }
    // 先頭を切り詰めた（truncateOldest）場合、残っている最小の通し番号から始まる。
    // そのため 1 からではなく、実際に残っている先頭を起点にして数える。
    // 起点より前は残っていないので、そこから先の連なりだけを確かめる。
    const startsAtSeq = rows[0]!.seq;
    let prevHash = rows[0]!.prevHash;
    let expectedSeq = startsAtSeq;
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
      const h = await sha256Hex(
        chainInput({
          seq: r.seq,
          action: r.action,
          atMs: r.atMs,
          payloadCiphertext: r.payloadCiphertext,
          prevHash: r.prevHash,
        }),
      );
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
    return { ok: true as const, checked: rows.length, headHash: prevHash, startsAtSeq };
  }),

  /**
   * 監査ログの切り詰め。連鎖の整合性を保つため、先頭からの削除しか許さない。
   * （末尾を消せると隠蔽できてしまうため）
   */
  truncateOldest: authed
    .input(z.object({ keepLatest: z.number().int().min(100).max(100000) }))
    .handler(async ({ context, input }) => {
      const uid = context.user.id;
      const [r] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.auditEvent)
        .where(eq(schema.auditEvent.userId, uid));
      const total = Number(r?.n ?? 0);
      if (total <= input.keepLatest) return { deleted: 0 };
      const toDelete = total - input.keepLatest;
      const olds = await db
        .select({ id: schema.auditEvent.id })
        .from(schema.auditEvent)
        .where(eq(schema.auditEvent.userId, uid))
        .orderBy(asc(schema.auditEvent.seq))
        .limit(toDelete);
      if (olds.length === 0) throw new ORPCError("BAD_REQUEST");
      await db.batch(
        olds.map((o) => db.delete(schema.auditEvent).where(eq(schema.auditEvent.id, o.id))) as never,
      );
      return { deleted: olds.length };
    }),
};
