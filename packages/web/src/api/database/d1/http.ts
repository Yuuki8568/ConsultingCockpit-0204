/** Complete candidate HTTP mount. Never selected by the production Worker yet. */
import type { D1Database } from "@cloudflare/workers-types";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, gt, desc, sql } from "drizzle-orm";
import { base, createApp } from "../../__core/app";
import { isAllowedOrigin } from "../../origins";
import * as s from "../schema";
import { authenticateD1, createD1Auth } from "./auth";
import { createD1Passkeys } from "./passkeys";
import { registerWriteKeyD1, writeChallengeD1 } from "./write-keys";
import { mutateDeviceD1 } from "./devices";
import { mutateVaultD1, unlockParamsD1 } from "./vault";
import { rekeyD1 } from "./rekey";
import { pushD1 } from "./sync";
import { sessionGuard, consumeD1Limit } from "./authorization";
import { auditPlanD1 } from "./audit-plan";
import { atomicCheckedBatch } from "../../../../../../cloudflare/d1/atomic-batch";
import { createD1Audit } from "./audit";
import type { WitnessService } from "./witness";

export function createD1Api(d1: D1Database, witness?: WitnessService, readOnly = false) {
  const q = drizzle(d1, { schema: s });
  const authed = base.use(async ({ context, next }) => {
    try {
      return await next({ context: await authenticateD1(d1, context.headers) });
    } catch (error) {
      if (error instanceof z.ZodError) throw new ORPCError("BAD_REQUEST");
      throw error;
    }
  });
  type Context = Awaited<ReturnType<typeof authenticateD1>>;
  const principal = (c: Context) => ({ userId: c.user.id, sessionId: c.session.id });
  const bound = (c: Context) => {
    if (!c.deviceId) throw new ORPCError("FORBIDDEN");
    return { ...principal(c), deviceId: c.deviceId };
  };
  const unknown = z.unknown();
  const router = {
    ping: base.handler(() => ({ message: `Pong! ${Date.now()}` })),
    passkeys: {
      list: authed.handler(({ context }) => createD1Passkeys(d1, context).list()),
      registrationOptions: authed.handler(({ context }) =>
        createD1Passkeys(d1, context).registrationOptions(),
      ),
      register: authed
        .input(unknown)
        .handler(({ context, input }) => createD1Passkeys(d1, context).register(input)),
      authenticationOptions: authed
        .input(unknown)
        .handler(({ context, input }) =>
          createD1Passkeys(d1, context).authenticationOptions(input),
        ),
      authenticate: authed
        .input(unknown)
        .handler(({ context, input }) => createD1Passkeys(d1, context).authenticate(input)),
    },
    writeKeys: {
      current: authed.handler(
        async ({ context }) =>
          (
            await q
              .select()
              .from(s.writeIdentity)
              .where(eq(s.writeIdentity.userId, context.user.id))
          )[0] ?? null,
      ),
      register: authed
        .input(unknown)
        .handler(({ context, input }) => registerWriteKeyD1(d1, principal(context), input)),
      challenge: authed
        .input(unknown)
        .handler(({ context, input }) => writeChallengeD1(d1, principal(context), input)),
    },
    vault: {
      status: authed.handler(async ({ context }) => {
        const [v] = await q.select().from(s.vault).where(eq(s.vault.userId, context.user.id));
        return v
          ? {
              exists: true,
              storageBackend: "d1" as const,
              kdfAlgo: v.kdfAlgo,
              kdfIterations: v.kdfIterations,
              generation: v.generation,
              createdAtMs: v.createdAtMs,
              updatedAtMs: v.updatedAtMs,
            }
          : { exists: false, storageBackend: "d1" as const };
      }),
      unlockParams: authed.handler(({ context }) => unlockParamsD1(d1, principal(context))),
      create: authed
        .input(unknown)
        .handler(({ context, input }) =>
          mutateVaultD1(d1, principal(context), "vault:create", input),
        ),
      rekey: authed
        .input(unknown)
        .handler(({ context, input }) => rekeyD1(d1, bound(context), input)),
      eraseAll: authed
        .input(unknown)
        .handler(({ context, input }) =>
          mutateVaultD1(d1, principal(context), "vault:erase", input),
        ),
    },
    sync: {
      push: authed
        .input(unknown)
        .handler(({ context, input }) => pushD1(d1, bound(context), input)),
      pullAll: authed
        .input(
          z.object({ deviceId: z.string().min(4).max(64), after: z.number().int().default(0) }),
        )
        .handler(async ({ context, input }) => {
          if (bound(context).deviceId !== input.deviceId) throw new ORPCError("FORBIDDEN");
          const size = await d1
            .prepare(
              "SELECT coalesce(sum(length(ciphertext)+length(iv)),0) bytes FROM record WHERE user_id=?",
            )
            .bind(context.user.id)
            .first<{ bytes: number }>();
          if (!size || size.bytes > 16777216) throw new ORPCError("PAYLOAD_TOO_LARGE");
          const rows = await q
            .select()
            .from(s.record)
            .where(
              and(
                eq(s.record.userId, context.user.id),
                gt(s.record.seq, input.after),
                sql`(SELECT coalesce(sum(length(ciphertext)+length(iv)),0) FROM record WHERE user_id=${context.user.id})<=16777216`,
              ),
            )
            .orderBy(s.record.seq)
            .limit(1000);
          return {
            records: rows.map((r) => ({
              id: r.id,
              type: r.type,
              ciphertext: r.ciphertext,
              iv: r.iv,
              updatedAtMs: r.updatedAtMs,
              version: r.version,
              deleted: r.deletedAt != null,
              seq: r.seq,
            })),
            cursor: rows.at(-1)?.seq ?? input.after,
            hasMore: rows.length === 1000,
          };
        }),
      stats: authed.handler(async ({ context }) => {
        const rows = await q
          .select({
            type: s.record.type,
            n: sql<number>`count(*)`,
            latest: sql<number>`max(updated_at_ms)`,
          })
          .from(s.record)
          .where(and(eq(s.record.userId, context.user.id), sql`deleted_at IS NULL`))
          .groupBy(s.record.type);
        const byType: Record<string, number> = {};
        let latest = 0;
        for (const r of rows) {
          byType[r.type] = Number(r.n);
          latest = Math.max(latest, Number(r.latest));
        }
        return { byType, latestUpdatedAtMs: latest };
      }),
      purgeDeleted: authed.input(unknown).handler(() => {
        throw new ORPCError("FORBIDDEN");
      }),
    },
    devices: {
      register: authed
        .input(unknown)
        .handler(({ context, input }) =>
          mutateDeviceD1(d1, principal(context), "device:register", input),
        ),
      revoke: authed
        .input(unknown)
        .handler(({ context, input }) =>
          mutateDeviceD1(d1, principal(context), "device:revoke", input),
        ),
      remove: authed
        .input(unknown)
        .handler(({ context, input }) =>
          mutateDeviceD1(d1, principal(context), "device:remove", input),
        ),
      unrevoke: authed
        .input(unknown)
        .handler(({ context, input }) =>
          mutateDeviceD1(d1, principal(context), "device:unrevoke", input),
        ),
      list: authed.handler(({ context }) =>
        q
          .select()
          .from(s.device)
          .where(eq(s.device.userId, context.user.id))
          .orderBy(desc(s.device.lastSeenAtMs)),
      ),
      loginHistory: authed
        .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
        .handler(({ context, input }) =>
          q
            .select()
            .from(s.loginEvent)
            .where(eq(s.loginEvent.userId, context.user.id))
            .orderBy(desc(s.loginEvent.atMs))
            .limit(input.limit),
        ),
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
          try {
            await consumeD1Limit(d1, `login:${context.user.id}`, 40, 60000);
          } catch (e) {
            if (e instanceof ORPCError && e.code === "TOO_MANY_REQUESTS")
              return { ok: true, skipped: true };
            throw e;
          }
          const x = q
            .insert(s.loginEvent)
            .values({
              id: crypto.randomUUID(),
              userId: context.user.id,
              atMs: Date.now(),
              kind: input.kind,
              platform: input.platform ?? null,
              userAgent: input.userAgent ?? null,
              deviceId: context.deviceId,
            })
            .toSQL();
          await atomicCheckedBatch(d1, [
            sessionGuard(d1, principal(context)),
            { statement: d1.prepare(x.sql).bind(...x.params), expectedChanges: 1 },
          ]);
          return { ok: true, skipped: false };
        }),
      clearLoginHistory: authed.handler(async ({ context }) => {
        const uid = context.user.id;
        const count = await d1
          .prepare("SELECT count(*) n FROM login_event WHERE user_id=?")
          .bind(uid)
          .first<{ n: number }>();
        await atomicCheckedBatch(d1, [
          sessionGuard(d1, principal(context)),
          {
            statement: d1.prepare("DELETE FROM login_event WHERE user_id=?").bind(uid),
            expectedChanges: count!.n,
          },
          ...(await auditPlanD1(d1, uid, context.deviceId, "history:clear")),
        ]);
        return { ok: true };
      }),
    },
    audit: createD1Audit(d1, witness),
  };
  const app = new Hono();
  app.use(
    "*",
    bodyLimit({
      maxSize: 4 * 1024 * 1024,
      onError: (c) => c.json({ error: "送信データは4MiB以下にしてください" }, 413),
    }),
  );
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const origin = c.req.header("origin");
    if (!isAllowedOrigin(origin)) return c.json({ error: "許可されていない接続元です" }, 403);
    if (c.req.method === "OPTIONS") {
      if (origin) {
        c.header("Access-Control-Allow-Origin", origin);
        c.header("Access-Control-Allow-Credentials", "true");
        c.header("Vary", "Origin");
      }
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return c.body(null, 204);
    }
    if (readOnly && c.req.path.startsWith("/api/rpc/")) {
      const allowed = new Set([
        "ping",
        "vault/status",
        "vault/unlockParams",
        "sync/pullAll",
        "sync/stats",
        "devices/list",
        "devices/loginHistory",
        "passkeys/list",
        "passkeys/registrationOptions",
        "passkeys/register",
        "passkeys/authenticationOptions",
        "passkeys/authenticate",
        "writeKeys/current",
        "audit/head",
        "audit/list",
        "audit/count",
        "audit/verifyChain",
      ]);
      if (!allowed.has(c.req.path.slice("/api/rpc/".length)))
        return c.json({ error: "保存先の切替中です。しばらくしてから再試行してください" }, 503);
    }
    await next();
  });
  app.on(["GET", "POST"], "/api/auth/*", (c) => createD1Auth(d1).handler(c.req.raw));
  app.route("/", createApp(router));
  return app;
}
