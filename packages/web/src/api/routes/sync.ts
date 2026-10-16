import { ORPCError } from "@orpc/server";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import * as schema from "../database/schema";
import { authed } from "../middleware/auth";

/**
 * 差分同期。
 *
 * 仕組み
 * ------------------------------------------------------------------
 * - クライアントは前回受け取った since（seq）を送る。サーバーはそれより新しい行だけ返す。
 * - 送信も同じ呼び出しで行う（push + pull を1往復にまとめる）。
 * - 競合はレコード単位の updatedAtMs 後勝ち。
 *   ただし負けた版を捨てず conflict として返し、クライアント側で
 *   「競合コピー」レコードとして保存できるようにする。
 * - サーバーは ciphertext を一切解釈しない。中身が何かは分からない。
 */

const recordInput = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(["case", "lead", "profile", "template", "meta", "log"]),
  // 1件あたりの上限を置く（1MB ≒ 平文768KB目安）。上限がないと、
  // 巨大な塊を積んで容量を食い潰す使い方ができてしまう。
  // 書類を何度も生成した案件はレコードが大きく育つため、256KB では
  // 途中で同期が恒久的に失敗する（2026-09-15 に再現確認）。
  ciphertext: z.string().max(1_048_576),
  iv: z.string().max(64),
  updatedAtMs: z.number().int(),
  deleted: z.boolean().default(false),
  /**
   * この編集が元にしたサーバー版の seq。
   * サーバーの現在の seq と一致していれば「相手の変更を見た上での編集」なので競合ではない。
   * 一致しないときだけ、上書きされる側を競合コピーとして返す。
   */
  baseSeq: z.number().int().default(0),
});

async function assertDeviceActive(userId: string, deviceId: string) {
  const [d] = await db
    .select()
    .from(schema.device)
    .where(and(eq(schema.device.userId, userId), eq(schema.device.id, deviceId)));
  if (d?.revokedAtMs) {
    throw new ORPCError("FORBIDDEN", {
      message: "この端末は失効しています。再度サインインしてください。",
    });
  }
  if (d) {
    await db
      .update(schema.device)
      .set({ lastSeenAtMs: Date.now() })
      .where(eq(schema.device.id, deviceId));
  }
}

export const sync = {
  /** push + pull を1往復で行う */
  push: authed
    .input(
      z.object({
        // 端末IDは必須。省略できると、失効させた端末が「端末IDを付けない」だけで
        // 失効判定を通り抜けてしまうため。
        deviceId: z.string().min(4).max(64),
        since: z.number().int().default(0),
        records: z.array(recordInput).max(500),
      }),
    )
    .handler(async ({ context, input }) => {
      const uid = context.user.id;
      await assertDeviceActive(uid, input.deviceId);

      const [v] = await db.select().from(schema.vault).where(eq(schema.vault.userId, uid));
      if (!v) throw new ORPCError("NOT_FOUND", { message: "金庫が未作成です" });

      const conflicts: {
        id: string;
        serverCiphertext: string;
        serverIv: string;
        serverUpdatedAtMs: number;
        losingSide: "client" | "server";
      }[] = [];
      const accepted: string[] = [];

      if (input.records.length > 0) {
        const ids = input.records.map((r) => r.id);
        const existing = await db
          .select()
          .from(schema.record)
          .where(and(eq(schema.record.userId, uid), inArray(schema.record.id, ids)));
        const byId = new Map(existing.map((e) => [e.id, e]));
        const now = Date.now();

        for (const r of input.records) {
          const cur = byId.get(r.id);
          if (!cur) {
            await db.insert(schema.record).values({
              id: r.id,
              userId: uid,
              type: r.type,
              ciphertext: r.ciphertext,
              iv: r.iv,
              updatedAtMs: r.updatedAtMs,
              version: 1,
              deletedAt: r.deleted ? now : null,
              deviceId: input.deviceId,
              seq: now,
            });
            accepted.push(r.id);
            continue;
          }
          if (r.updatedAtMs > cur.updatedAtMs) {
            // クライアントが新しい → 採用。
            // ただしサーバー版が「この端末が知らない変更」だったときだけ競合として返す。
            // 自分の1つ前の版を上書きしただけなら競合ではない。
            const sawServerVersion = r.baseSeq === cur.seq;
            if (cur.ciphertext !== r.ciphertext && !sawServerVersion) {
              conflicts.push({
                id: r.id,
                serverCiphertext: cur.ciphertext,
                serverIv: cur.iv,
                serverUpdatedAtMs: cur.updatedAtMs,
                losingSide: "server",
              });
            }
            await db
              .update(schema.record)
              .set({
                ciphertext: r.ciphertext,
                iv: r.iv,
                updatedAtMs: r.updatedAtMs,
                version: cur.version + 1,
                deletedAt: r.deleted ? now : null,
                deviceId: input.deviceId,
                seq: now,
              })
              .where(and(eq(schema.record.userId, uid), eq(schema.record.id, r.id)));
            accepted.push(r.id);
          } else if (r.updatedAtMs < cur.updatedAtMs) {
            // サーバーが新しい → クライアント版が負け
            conflicts.push({
              id: r.id,
              serverCiphertext: cur.ciphertext,
              serverIv: cur.iv,
              serverUpdatedAtMs: cur.updatedAtMs,
              losingSide: "client",
            });
          }
          // 同時刻・同内容は何もしない
        }
      }

      // pull: since より新しい行
      const changed = await db
        .select()
        .from(schema.record)
        .where(and(eq(schema.record.userId, uid), gt(schema.record.seq, input.since)))
        .orderBy(schema.record.seq)
        .limit(1000);

      const cursor = changed.length > 0 ? changed[changed.length - 1].seq : input.since;

      return {
        generation: v.generation,
        accepted,
        conflicts,
        changed: changed.map((c) => ({
          id: c.id,
          type: c.type,
          ciphertext: c.ciphertext,
          iv: c.iv,
          updatedAtMs: c.updatedAtMs,
          version: c.version,
          deleted: c.deletedAt != null,
          seq: c.seq,
        })),
        cursor,
        hasMore: changed.length === 1000,
      };
    }),

  /** 初回・復旧用の全件取得。失効端末からは取得できない。 */
  pullAll: authed
    .input(
      z.object({
        deviceId: z.string().min(4).max(64),
        after: z.number().int().default(0),
      }),
    )
    .handler(async ({ context, input }) => {
      const uid = context.user.id;
      await assertDeviceActive(uid, input.deviceId);
      const rows = await db
        .select()
        .from(schema.record)
        .where(and(eq(schema.record.userId, uid), gt(schema.record.seq, input.after)))
        .orderBy(schema.record.seq)
        .limit(1000);
      const cursor = rows.length > 0 ? rows[rows.length - 1].seq : input.after;
      return {
        records: rows.map((c) => ({
          id: c.id,
          type: c.type,
          ciphertext: c.ciphertext,
          iv: c.iv,
          updatedAtMs: c.updatedAtMs,
          version: c.version,
          deleted: c.deletedAt != null,
          seq: c.seq,
        })),
        cursor,
        hasMore: rows.length === 1000,
      };
    }),

  /** 保存状況の概観（件数と最終更新）。中身は見えないので件数だけ。 */
  stats: authed.handler(async ({ context }) => {
    const rows = await db
      .select({
        type: schema.record.type,
        n: sql<number>`count(*)`,
        latest: sql<number>`max(${schema.record.updatedAtMs})`,
      })
      .from(schema.record)
      .where(
        and(eq(schema.record.userId, context.user.id), sql`${schema.record.deletedAt} is null`),
      )
      .groupBy(schema.record.type);
    const byType: Record<string, number> = {};
    let latest = 0;
    for (const r of rows) {
      byType[r.type] = Number(r.n);
      if (Number(r.latest) > latest) latest = Number(r.latest);
    }
    return { byType, latestUpdatedAtMs: latest };
  }),

  /** 保持期間ポリシーの適用：論理削除から N 日超えた行を物理削除する */
  purgeDeleted: authed
    .input(z.object({ olderThanDays: z.number().int().min(1).max(3650) }))
    .handler(async ({ context, input }) => {
      const cutoff = Date.now() - input.olderThanDays * 86400000;
      const rows = await db
        .select({ id: schema.record.id })
        .from(schema.record)
        .where(
          and(
            eq(schema.record.userId, context.user.id),
            sql`${schema.record.deletedAt} is not null`,
            sql`${schema.record.deletedAt} < ${cutoff}`,
          ),
        );
      if (rows.length > 0) {
        await db.delete(schema.record).where(
          and(
            eq(schema.record.userId, context.user.id),
            inArray(
              schema.record.id,
              rows.map((r) => r.id),
            ),
          ),
        );
      }
      return { purged: rows.length };
    }),
};
