import { ORPCError } from "@orpc/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import * as schema from "../database/schema";
import { authed } from "../middleware/auth";

/**
 * 金庫メタの管理。
 * ここで扱うのは salt / 反復回数 / 検証トークンのみ。
 * パスフレーズも金庫鍵もサーバーには送られてこない。
 */
/** 1件の暗号文として受け取る上限（文字数）。約256KB相当。 */
const MAX_CIPHERTEXT_LEN = 262_144;

/** 解錠材料の受け渡しを数える窓（分） */
const UNLOCK_WINDOW_MIN = 15;
/** 窓の中で受け取れる上限回数 */
const UNLOCK_PARAMS_MAX = 20;
/** 上限を超えた後、渡さずに待たせる時間（分） */
const UNLOCK_LOCK_MIN = 5;

export const vault = {
  /**
   * 金庫の有無と、秘密にあたらない情報だけを返す。
   * 鍵の材料（salt・検証トークン）はここでは返さない。→ unlockParams
   */
  status: authed.handler(async ({ context }) => {
    const [v] = await db
      .select()
      .from(schema.vault)
      .where(eq(schema.vault.userId, context.user.id));
    if (!v) return { exists: false as const };
    return {
      exists: true as const,
      kdfAlgo: v.kdfAlgo,
      kdfIterations: v.kdfIterations,
      generation: v.generation,
      createdAtMs: v.createdAtMs,
      updatedAtMs: v.updatedAtMs,
    };
  }),

  /**
   * 解錠に使う材料（salt・反復回数・検証トークン）を渡す。
   *
   * この材料があれば、手元で合言葉の当てずっぽうを繰り返せてしまうため、
   * 受け取れる回数をサーバー側でも数える。
   *   ・15分の間に UNLOCK_PARAMS_MAX 回を超えたら、UNLOCK_LOCK_MIN 分は渡さない
   *   ・受け取った記録は履歴（unlock_params）に残る
   * 合言葉そのものは、これまでどおりサーバーに送られない。
   */
  unlockParams: authed.handler(async ({ context }) => {
    const uid = context.user.id;
    const now = Date.now();
    const windowFrom = now - UNLOCK_WINDOW_MIN * 60_000;

    const recent = await db
      .select()
      .from(schema.loginEvent)
      .where(
        and(
          eq(schema.loginEvent.userId, uid),
          eq(schema.loginEvent.kind, "unlock_params"),
          gte(schema.loginEvent.atMs, windowFrom),
        ),
      )
      .orderBy(desc(schema.loginEvent.atMs));

    if (recent.length >= UNLOCK_PARAMS_MAX) {
      const last = recent[0]!.atMs;
      const until = last + UNLOCK_LOCK_MIN * 60_000;
      if (now < until) {
        await db.insert(schema.loginEvent).values({
          id: crypto.randomUUID(),
          userId: uid,
          atMs: now,
          kind: "server_throttle",
          platform: null,
          userAgent: null,
          deviceId: null,
        });
        throw new ORPCError("TOO_MANY_REQUESTS", {
          message: `解錠の試行が続いたため、${Math.ceil((until - now) / 60_000)}分ほどお待ちください。`,
        });
      }
    }

    const [v] = await db
      .select()
      .from(schema.vault)
      .where(eq(schema.vault.userId, uid));
    if (!v) throw new ORPCError("NOT_FOUND", { message: "金庫が見つかりません" });

    await db.insert(schema.loginEvent).values({
      id: crypto.randomUUID(),
      userId: uid,
      atMs: now,
      kind: "unlock_params",
      platform: null,
      userAgent: null,
      deviceId: null,
    });

    return {
      kdfSalt: v.kdfSalt,
      kdfAlgo: v.kdfAlgo,
      kdfIterations: v.kdfIterations,
      verifierCiphertext: v.verifierCiphertext,
      verifierIv: v.verifierIv,
      generation: v.generation,
    };
  }),

  /** 金庫を新規作成（初回のパスフレーズ設定） */
  create: authed
    .input(
      z.object({
        kdfSalt: z.string().min(16).max(256),
        kdfIterations: z.number().int().min(100_000).max(2_000_000),
        verifierCiphertext: z.string().min(1).max(4096),
        verifierIv: z.string().min(1).max(64),
      }),
    )
    .handler(async ({ context, input }) => {
      const [existing] = await db
        .select()
        .from(schema.vault)
        .where(eq(schema.vault.userId, context.user.id));
      if (existing) {
        throw new ORPCError("CONFLICT", {
          message: "この利用者の金庫はすでに作成されています",
        });
      }
      const now = Date.now();
      await db.insert(schema.vault).values({
        userId: context.user.id,
        kdfSalt: input.kdfSalt,
        kdfAlgo: "PBKDF2-SHA256",
        kdfIterations: input.kdfIterations,
        verifierCiphertext: input.verifierCiphertext,
        verifierIv: input.verifierIv,
        generation: 1,
        createdAtMs: now,
        updatedAtMs: now,
      });
      return { ok: true, generation: 1 };
    }),

  /**
   * パスフレーズ変更。
   * 全レコードを新しい鍵で再暗号化したものをクライアントから受け取り、まとめて差し替える。
   * 途中で失敗して読めなくなることを避けるため、1トランザクションで置き換える。
   */
  rekey: authed
    .input(
      z.object({
        kdfSalt: z.string().min(16).max(256),
        kdfIterations: z.number().int().min(100_000).max(2_000_000),
        verifierCiphertext: z.string().min(1).max(4096),
        verifierIv: z.string().min(1).max(64),
        records: z
          .array(
            z.object({
              id: z.string().max(200),
              ciphertext: z.string().max(MAX_CIPHERTEXT_LEN),
              iv: z.string().max(64),
            }),
          )
          .max(5000),
      }),
    )
    .handler(async ({ context, input }) => {
      const [v] = await db
        .select()
        .from(schema.vault)
        .where(eq(schema.vault.userId, context.user.id));
      if (!v) throw new ORPCError("NOT_FOUND", { message: "金庫が見つかりません" });

      const now = Date.now();
      await db.batch([
        db
          .update(schema.vault)
          .set({
            kdfSalt: input.kdfSalt,
            kdfIterations: input.kdfIterations,
            verifierCiphertext: input.verifierCiphertext,
            verifierIv: input.verifierIv,
            generation: v.generation + 1,
            updatedAtMs: now,
          })
          .where(eq(schema.vault.userId, context.user.id)),
        ...input.records.map((r) =>
          db
            .update(schema.record)
            .set({ ciphertext: r.ciphertext, iv: r.iv })
            .where(
              and(eq(schema.record.userId, context.user.id), eq(schema.record.id, r.id)),
            ),
        ),
      ] as never);
      return { ok: true, generation: v.generation + 1, reEncrypted: input.records.length };
    }),

  /**
   * 全消去。金庫メタ・全レコード・監査ログ・端末を消す。
   * 元アプリの「全データ消去」に相当。復元不可。
   */
  eraseAll: authed
    .input(z.object({ confirm: z.literal("ERASE") }))
    .handler(async ({ context }) => {
      const uid = context.user.id;
      await db.batch([
        db.delete(schema.record).where(eq(schema.record.userId, uid)),
        db.delete(schema.auditEvent).where(eq(schema.auditEvent.userId, uid)),
        db.delete(schema.loginEvent).where(eq(schema.loginEvent.userId, uid)),
        db.delete(schema.device).where(eq(schema.device.userId, uid)),
        db.delete(schema.vault).where(eq(schema.vault.userId, uid)),
      ] as never);
      return { ok: true };
    }),
};
