import { ciphertextInput, ivInput } from "../security/inputs";
import { archiveRecords, syncBudget } from "../security/controls";
import { MAX_SYNC_RECORDS } from "../../shared/sync-limits";
import { ORPCError } from "@orpc/server";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import * as schema from "../database/schema";
import { authed } from "../middleware/auth";
import { classifySyncError } from "../sync-diagnostics";

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
  ciphertext: ciphertextInput,
  iv: ivInput,
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
  if (!d || d.revokedAtMs) {
    throw new ORPCError("FORBIDDEN", {
      message: "この端末は失効しています。再度サインインしてください。",
    });
  }
  if (d) {
    await db
      .update(schema.device)
      .set({ lastSeenAtMs: Date.now() })
      .where(and(eq(schema.device.userId, userId), eq(schema.device.id, deviceId)));
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
        generation: z.number().int().min(1),
        since: z.number().int().min(0).default(0),
        records: z.array(recordInput).max(MAX_SYNC_RECORDS, "同期の更新が必要です。ページを再読み込みしてください。"),
      }),
    )
    .handler(async ({ context, input }) => {
      const uid = context.user.id;
      let stage = "device-check";
      try {
      await assertDeviceActive(uid, input.deviceId);
      await syncBudget(uid, input, input.records.length);

      stage = "transaction-open";
      return await db.transaction(async tx => {
      stage = "vault-read";
      const [v] = await tx.select().from(schema.vault).where(eq(schema.vault.userId, uid));
      if (!v) throw new ORPCError("NOT_FOUND", { message: "金庫が未作成です" });
      if (v.generation !== input.generation) throw new ORPCError("CONFLICT", { message: "鍵が変更されました。再解錠してください" });
      if (new Set(input.records.map(r => r.id)).size !== input.records.length) throw new ORPCError("BAD_REQUEST");
      stage = "sequence-read";
      const [maximum] = await tx.select({ value: sql<number>`coalesce(max(${schema.record.seq}), 0)` }).from(schema.record).where(eq(schema.record.userId, uid));
      let nextSeq = Math.max(Date.now(), Number(maximum?.value ?? 0));

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
        stage = "existing-records-read";
        const existing = await tx
          .select()
          .from(schema.record)
          .where(and(eq(schema.record.userId, uid), inArray(schema.record.id, ids)));
        const byId = new Map(existing.map((e) => [e.id, e]));
        await archiveRecords(tx, existing.filter(cur => input.records.some(r => r.id === cur.id && r.baseSeq === cur.seq && r.type === cur.type)), v);
        const now = Date.now();

        for (const r of input.records) {
          const cur = byId.get(r.id);
          if (!cur) {
            if (r.deleted || r.baseSeq !== 0) throw new ORPCError("CONFLICT", { message: "未取得のレコードは上書き・削除できません" });
            stage = "record-insert";
            await tx.insert(schema.record).values({
              id: r.id,
              userId: uid,
              type: r.type,
              ciphertext: r.ciphertext,
              iv: r.iv,
              updatedAtMs: r.updatedAtMs,
              version: 1,
              deletedAt: r.deleted ? now : null,
              deviceId: input.deviceId,
              seq: ++nextSeq,
            });
            accepted.push(r.id);
            continue;
          }
          if (r.baseSeq === cur.seq && r.type === cur.type) {
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
            stage = "record-update";
            await tx
              .update(schema.record)
              .set({
                ciphertext: r.ciphertext,
                iv: r.iv,
                updatedAtMs: r.updatedAtMs,
                version: cur.version + 1,
                deletedAt: r.deleted ? now : null,
                deviceId: input.deviceId,
                seq: ++nextSeq,
              })
              .where(and(eq(schema.record.userId, uid), eq(schema.record.id, r.id)));
            accepted.push(r.id);
          } else if (r.ciphertext !== cur.ciphertext || r.iv !== cur.iv || r.deleted !== (cur.deletedAt != null)) {
            // サーバーが新しい → クライアント版が負け
            conflicts.push({
              id: r.id,
              serverCiphertext: cur.ciphertext,
              serverIv: cur.iv,
              serverUpdatedAtMs: cur.updatedAtMs,
              losingSide: "client",
            });
          }
          else { accepted.push(r.id); }
          // Identical retransmissions are acknowledged without rewriting.
        }
      }

      // pull: since より新しい行
      stage = "changed-records-read";
      const changed = await tx
        .select()
        .from(schema.record)
        .where(and(eq(schema.record.userId, uid), gt(schema.record.seq, input.since)))
        .orderBy(schema.record.seq)
        .limit(1000);

      const cursor = changed.length > 0 ? changed[changed.length - 1].seq : input.since;
      const fullPage = changed.length === 1000;
      // Old releases used millisecond timestamps: include ties at a page boundary.
      if (fullPage) {
        const ties = await tx.select().from(schema.record).where(and(eq(schema.record.userId, uid), eq(schema.record.seq, cursor)));
        const seen = new Set(changed.map(r => r.id));
        changed.push(...ties.filter(r => !seen.has(r.id)));
      }
      const conflictIds = conflicts.map(c => c.id);
      if (conflictIds.length) {
        const current = await tx.select().from(schema.record).where(and(eq(schema.record.userId, uid), inArray(schema.record.id, conflictIds)));
        const seen = new Set(changed.map(r => r.id));
        changed.push(...current.filter(r => !seen.has(r.id)));
      }
      const acceptedVersions: Record<string, number> = {};
      if (accepted.length) {
        stage = "accepted-records-read";
        const saved = await tx.select().from(schema.record).where(and(eq(schema.record.userId, uid), inArray(schema.record.id, accepted)));
        for (const row of saved) acceptedVersions[row.id] = row.seq;
      }

      stage = "transaction-commit";
      return {
        generation: v.generation,
        accepted,
        acceptedVersions,
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
        hasMore: fullPage,
      };
      });
      } catch (error) {
        if (!(error instanceof ORPCError) || error.status >= 500) {
          console.error(JSON.stringify({
            event: "sync_push_failed",
            stage,
            recordCount: input.records.length,
            ...classifySyncError(error),
          }));
        }
        throw error;
      }
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
