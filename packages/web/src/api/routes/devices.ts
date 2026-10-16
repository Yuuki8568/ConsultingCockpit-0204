import { and, count, desc, eq, gte, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import * as schema from "../database/schema";
import { authed, recentlyAuthed } from "../middleware/auth";

/** 端末管理とログイン履歴。v3 のログイン履歴に「端末の失効」を追加したもの。 */
export const devices = {
  /** この端末を登録（既存なら最終利用日時を更新） */
  register: authed
    .input(
      z.object({
        id: z.string().min(4).max(64),
        label: z.string().max(80),
        platform: z.string().max(40),
        userAgent: z.string().max(400).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const now = Date.now();
      const [existing] = await db
        .select()
        .from(schema.device)
        .where(and(eq(schema.device.userId, context.user.id), eq(schema.device.id, input.id)));
      if (existing) {
        await db
          .update(schema.device)
          .set({ lastSeenAtMs: now, label: input.label, userAgent: input.userAgent ?? null })
          .where(eq(schema.device.id, input.id));
        return { ok: true, revoked: existing.revokedAtMs != null };
      }
      await db.insert(schema.device).values({
        id: input.id,
        userId: context.user.id,
        label: input.label,
        platform: input.platform,
        userAgent: input.userAgent ?? null,
        createdAtMs: now,
        lastSeenAtMs: now,
      });
      return { ok: true, revoked: false };
    }),

  list: authed.handler(({ context }) =>
    db
      .select()
      .from(schema.device)
      .where(eq(schema.device.userId, context.user.id))
      .orderBy(desc(schema.device.lastSeenAtMs)),
  ),

  /**
   * 端末を失効させる。以後その端末からの同期は拒否される。
   *
   * あわせて、いま操作している端末以外のサインイン状態（session）を消す。
   * 失効させた端末に残っていた「サインイン済み」の状態だけが生き続けて、
   * 履歴や端末一覧を読めてしまうのを避けるため。
   * 手元の端末は続けて使えるが、他の端末は次から再サインインが必要になる。
   */
  revoke: authed
    .input(z.object({ id: z.string().min(1).max(200) }))
    .handler(async ({ context, input }) => {
      await db
        .update(schema.device)
        .set({ revokedAtMs: Date.now() })
        .where(and(eq(schema.device.userId, context.user.id), eq(schema.device.id, input.id)));
      const currentSessionId = context.session?.id;
      if (currentSessionId) {
        await db
          .delete(schema.session)
          .where(
            and(
              eq(schema.session.userId, context.user.id),
              ne(schema.session.id, currentSessionId),
            ),
          );
      } else {
        await db.delete(schema.session).where(eq(schema.session.userId, context.user.id));
      }
      return { ok: true };
    }),

  unrevoke: recentlyAuthed
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      await db
        .update(schema.device)
        .set({ revokedAtMs: null })
        .where(and(eq(schema.device.userId, context.user.id), eq(schema.device.id, input.id)));
      return { ok: true };
    }),

  remove: authed.input(z.object({ id: z.string() })).handler(async ({ context, input }) => {
    await db
      .delete(schema.device)
      .where(and(eq(schema.device.userId, context.user.id), eq(schema.device.id, input.id)));
    return { ok: true };
  }),

  /** ログイン・解錠イベントの記録 */
  logLogin: authed
    .input(
      z.object({
        kind: z.enum([
          "signin",
          "unlock_ok",
          "unlock_fail",
          "lockout",
          "manual_lock",
          "auto_lock",
          "signout",
        ]),
        platform: z.string().max(40).optional(),
        userAgent: z.string().max(400).optional(),
        deviceId: z.string().max(64).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      // 履歴の埋め立て（大量の書き込みで古い記録を押し流す）を防ぐため、
      // 直近1分の書き込み数に上限を置く。上限を超えた分は静かに捨てる。
      const now = Date.now();
      const [{ n } = { n: 0 }] = await db
        .select({ n: count() })
        .from(schema.loginEvent)
        .where(
          and(
            eq(schema.loginEvent.userId, context.user.id),
            gte(schema.loginEvent.atMs, now - 60_000),
          ),
        );
      if (Number(n) >= 40) return { ok: true, skipped: true };

      await db.insert(schema.loginEvent).values({
        id: crypto.randomUUID(),
        userId: context.user.id,
        atMs: now,
        kind: input.kind,
        platform: input.platform ?? null,
        userAgent: input.userAgent ?? null,
        deviceId: input.deviceId ?? null,
      });
      return { ok: true, skipped: false };
    }),

  loginHistory: authed
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
    .handler(({ context, input }) =>
      db
        .select()
        .from(schema.loginEvent)
        .where(eq(schema.loginEvent.userId, context.user.id))
        .orderBy(desc(schema.loginEvent.atMs))
        .limit(input.limit),
    ),

  clearLoginHistory: authed.handler(async ({ context }) => {
    await db.delete(schema.loginEvent).where(eq(schema.loginEvent.userId, context.user.id));
    return { ok: true };
  }),
};
