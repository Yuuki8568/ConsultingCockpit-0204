/** D1 candidate: caller must authenticate owner/origin before constructing this request-local service. */
import { ORPCError } from "@orpc/server";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { and, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { atomicCheckedBatch } from "../../../../../../cloudflare/d1/atomic-batch";
import { sessionGuard, consumeD1Limit } from "./authorization";
import * as s from "../schema";

import { approvedFingerprint } from "../../security/step-up";
import { operationHash } from "../../../shared/operation-proof";
function target() {
  const url = new URL(process.env.WEBSITE_URL!);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1")
    throw new Error("HTTPS required");
  return { rpID: url.hostname, origin: url.origin };
}
async function approved(row: typeof s.passkeyCredential.$inferSelect) {
  return approvedFingerprint(
    await operationHash({ userId: row.userId, id: row.id, publicKey: row.publicKey }),
  );
}
const actions = z.enum([
  "device:register",
  "device:revoke",
  "device:unrevoke",
  "device:remove",
  "vault:create",
  "vault:rekey",
  "vault:erase",
  "write-key:register",
]);
export function createD1Passkeys(
  d1: D1Database,
  context: { user: { id: string; email: string }; session: { id: string } },
) {
  const db = drizzle(d1, { schema: s });
  const p = { userId: context.user.id, sessionId: context.session.id };
  async function insert(
    table: typeof s.securityChallenge,
    values: typeof s.securityChallenge.$inferInsert,
  ) {
    const q = db.insert(table).values(values).toSQL();
    await atomicCheckedBatch(d1, [
      sessionGuard(d1, p),
      { statement: d1.prepare(q.sql).bind(...q.params), expectedChanges: 1 },
    ]);
  }
  async function limit(uid: string) {
    await consumeD1Limit(d1, `passkey:${uid}`, 30, 60000);
    await db
      .delete(s.securityChallenge)
      .where(
        and(eq(s.securityChallenge.userId, uid), lt(s.securityChallenge.expiresAtMs, Date.now())),
      );
    await db
      .delete(s.stepUpTicket)
      .where(and(eq(s.stepUpTicket.userId, uid), lt(s.stepUpTicket.expiresAtMs, Date.now())));
  }
  async function take(uid: string, sid: string, id: string, kind: string) {
    const [row] = await db
      .select()
      .from(s.securityChallenge)
      .where(
        and(
          eq(s.securityChallenge.id, id),
          eq(s.securityChallenge.userId, uid),
          eq(s.securityChallenge.sessionId, sid),
          eq(s.securityChallenge.kind, kind),
          gt(s.securityChallenge.expiresAtMs, Date.now()),
        ),
      );
    if (!row) throw new ORPCError("UNAUTHORIZED");
    await atomicCheckedBatch(d1, [
      sessionGuard(d1, p),
      {
        statement: d1
          .prepare(
            `DELETE FROM security_challenge WHERE id=? AND user_id=? AND session_id=? AND kind=? AND challenge=? AND action=? AND payload_hash=? AND expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)`,
          )
          .bind(id, uid, sid, kind, row.challenge, row.action, row.payloadHash),
        expectedChanges: 1,
      },
    ]);
    return row;
  }
  return {
    list: async () =>
      Promise.all(
        (
          await db
            .select()
            .from(s.passkeyCredential)
            .where(eq(s.passkeyCredential.userId, context.user.id))
        ).map(async (r) => ({
          id: r.id,
          fingerprint: r.fingerprint,
          createdAtMs: r.createdAtMs,
          approved: await approved(r),
        })),
      ),
    registrationOptions: async () => {
      const uid = context.user.id;
      await limit(uid);
      const rows = await db
        .select()
        .from(s.passkeyCredential)
        .where(eq(s.passkeyCredential.userId, uid));
      if (rows.length >= 5)
        throw new ORPCError("FORBIDDEN", {
          message: "登録候補は5件までです。管理者による候補の整理が必要です",
        });
      const options = await generateRegistrationOptions({
        rpName: "Cockpit",
        rpID: target().rpID,
        userName: context.user.email,
        userID: new Uint8Array(new TextEncoder().encode(uid)),
        attestationType: "none",
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        excludeCredentials: rows.map((r) => ({ id: r.id })),
      });
      const id = crypto.randomUUID();
      await insert(s.securityChallenge, {
        id,
        userId: uid,
        sessionId: context.session.id,
        kind: "register",
        challenge: options.challenge,
        action: "",
        payloadHash: "",
        expiresAtMs: Date.now() + 300000,
      });
      return { id, options };
    },
    register: async (raw: unknown) => {
      const input = z.object({ id: z.string().uuid(), response: z.unknown() }).parse(raw);
      await limit(context.user.id);
      const row = await take(context.user.id, context.session.id, input.id, "register");
      const t = target();
      let result;
      try {
        result = await verifyRegistrationResponse({
          response: input.response as RegistrationResponseJSON,
          expectedChallenge: row.challenge,
          expectedOrigin: t.origin,
          expectedRPID: t.rpID,
          requireUserVerification: true,
        });
      } catch {
        throw new ORPCError("UNAUTHORIZED");
      }
      if (!result.verified || !result.registrationInfo) throw new ORPCError("UNAUTHORIZED");
      const c = result.registrationInfo.credential;
      const publicKey = Buffer.from(c.publicKey).toString("base64");
      const fingerprint = await operationHash({ userId: context.user.id, id: c.id, publicKey });
      const query = db
        .insert(s.passkeyCredential)
        .values({
          id: c.id,
          userId: context.user.id,
          publicKey,
          counter: c.counter,
          fingerprint,
          createdAtMs: Date.now(),
        })
        .toSQL();
      await atomicCheckedBatch(d1, [
        sessionGuard(d1, p),
        {
          statement: d1
            .prepare(
              "UPDATE session SET updated_at=updated_at WHERE id=? AND (SELECT count(*) FROM passkey_credential WHERE user_id=?)<5",
            )
            .bind(p.sessionId, p.userId),
          expectedChanges: 1,
        },
        { statement: d1.prepare(query.sql).bind(...query.params), expectedChanges: 1 },
      ]);
      return { fingerprint, approved: false };
    },
    authenticationOptions: async (raw: unknown) => {
      const input = z
        .object({ action: actions, payloadHash: z.string().regex(/^[0-9a-f]{64}$/) })
        .parse(raw);
      await limit(context.user.id);
      const rows = await db
        .select()
        .from(s.passkeyCredential)
        .where(eq(s.passkeyCredential.userId, context.user.id));
      const usable = [];
      for (const r of rows) if (await approved(r)) usable.push(r);
      if (!usable.length)
        throw new ORPCError("FORBIDDEN", {
          message:
            "承認済みのパスキーがありません。登録後、管理者が照合番号を別途確認する必要があります",
        });
      const options = await generateAuthenticationOptions({
        rpID: target().rpID,
        userVerification: "required",
        allowCredentials: usable.map((r) => ({ id: r.id })),
      });
      const id = crypto.randomUUID();
      await insert(s.securityChallenge, {
        id,
        userId: context.user.id,
        sessionId: context.session.id,
        kind: "authenticate",
        challenge: options.challenge,
        action: input.action,
        payloadHash: input.payloadHash,
        expiresAtMs: Date.now() + 300000,
      });
      return { id, options };
    },
    authenticate: async (raw: unknown) => {
      const input = z.object({ id: z.string().uuid(), response: z.unknown() }).parse(raw);
      await limit(context.user.id);
      const row = await take(context.user.id, context.session.id, input.id, "authenticate");
      const response = input.response as AuthenticationResponseJSON;
      if (!response || typeof response.id !== "string") throw new ORPCError("UNAUTHORIZED");
      const [c] = await db
        .select()
        .from(s.passkeyCredential)
        .where(
          and(
            eq(s.passkeyCredential.userId, context.user.id),
            eq(s.passkeyCredential.id, response.id),
          ),
        );
      if (!c || !(await approved(c))) throw new ORPCError("UNAUTHORIZED");
      const t = target();
      let result;
      try {
        result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: row.challenge,
          expectedOrigin: t.origin,
          expectedRPID: t.rpID,
          requireUserVerification: true,
          credential: {
            id: c.id,
            publicKey: new Uint8Array(Buffer.from(c.publicKey, "base64")),
            counter: c.counter,
          },
        });
      } catch {
        throw new ORPCError("UNAUTHORIZED");
      }
      if (!result.verified) throw new ORPCError("UNAUTHORIZED");
      const id = crypto.randomUUID();
      const ticket = db
        .insert(s.stepUpTicket)
        .values({
          id,
          userId: p.userId,
          sessionId: p.sessionId,
          action: row.action,
          payloadHash: row.payloadHash,
          expiresAtMs: Date.now() + 60000,
        })
        .toSQL();
      await atomicCheckedBatch(d1, [
        sessionGuard(d1, p),
        {
          statement: d1
            .prepare(
              "UPDATE passkey_credential SET counter=? WHERE id=? AND user_id=? AND counter=? AND public_key=?",
            )
            .bind(result.authenticationInfo.newCounter, c.id, p.userId, c.counter, c.publicKey),
          expectedChanges: 1,
        },
        { statement: d1.prepare(ticket.sql).bind(...ticket.params), expectedChanges: 1 },
      ]);
      return { id };
    },
  };
}
