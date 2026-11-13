import { appendAudit } from "../security/audit";
import { ORPCError } from "@orpc/server";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import * as s from "../database/schema";
import { authed } from "../middleware/auth";
import { ciphertextInput, ivInput } from "../security/inputs";
import { requireStepUp } from "../security/step-up";
import { consumeLimit, type Transaction } from "../security/controls";
import { operationHash, signingMessage } from "../../shared/operation-proof";
export const writeKeys = {
  current: authed.handler(
    async ({ context }) =>
      (
        await db.select().from(s.writeIdentity).where(eq(s.writeIdentity.userId, context.user.id))
      )[0] ?? null,
  ),
  register: authed
    .input(
      z.object({
        publicKey: z
          .object({
            kty: z.literal("EC"),
            crv: z.literal("P-256"),
            x: z.string().regex(/^[\w-]{43}$/),
            y: z.string().regex(/^[\w-]{43}$/),
          })
          .strict(),
        privateCiphertext: ciphertextInput,
        privateIv: ivInput,
        generation: z.number().int().positive(),
        expectedVersion: z.number().int().nonnegative(),
        authorization: z.string().uuid().optional(),
      }),
    )
    .handler(async ({ context, input }) =>
      db.transaction(async (tx) => {
        await requireStepUp(
          tx,
          context.user.id,
          context.session.id,
          "write-key:register",
          input,
          input.authorization,
        );
        const [v] = await tx.select().from(s.vault).where(eq(s.vault.userId, context.user.id));
        if (v?.generation !== input.generation) throw new ORPCError("CONFLICT");
        const [old] = await tx
          .select()
          .from(s.writeIdentity)
          .where(eq(s.writeIdentity.userId, context.user.id));
        if ((old?.version ?? 0) !== input.expectedVersion) throw new ORPCError("CONFLICT");
        try {
          await crypto.subtle.importKey(
            "jwk",
            input.publicKey,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["verify"],
          );
        } catch {
          throw new ORPCError("BAD_REQUEST");
        }
        const values = {
          userId: context.user.id,
          publicKey: JSON.stringify(input.publicKey),
          privateCiphertext: input.privateCiphertext,
          privateIv: input.privateIv,
          generation: input.generation,
          version: input.expectedVersion + 1,
        };
        await tx
          .insert(s.writeIdentity)
          .values(values)
          .onConflictDoUpdate({ target: s.writeIdentity.userId, set: values });
        await appendAudit(tx, context.user.id, context.deviceId, "write-key:register");
        return { ok: true };
      }),
    ),
  challenge: authed
    .input(
      z.object({ deviceId: z.string().max(64), payloadHash: z.string().regex(/^[0-9a-f]{64}$/) }),
    )
    .handler(async ({ context, input }) => {
      if (context.deviceId !== input.deviceId) throw new ORPCError("FORBIDDEN");
      if (
        !(await db.transaction((tx) =>
          consumeLimit(tx, `write-challenge:${context.user.id}`, 1, 60, 60000),
        ))
      )
        throw new ORPCError("TOO_MANY_REQUESTS");
      const value = {
        id: crypto.randomUUID(),
        userId: context.user.id,
        sessionId: context.session.id,
        payloadHash: input.payloadHash,
        expiresAtMs: Date.now() + 60000,
      };
      await db
        .insert(s.securityChallenge)
        .values({ ...value, kind: "write", action: "sync:push", challenge: "" });
      return value;
    }),
};
export async function verifyWrite(
  tx: Transaction,
  uid: string,
  sid: string,
  input: { generation: number; proof?: { id: string; signature: string } },
) {
  const proof = input.proof;
  if (!proof)
    throw new ORPCError("UNAUTHORIZED", {
      message: "金庫を解錠し、設定から書き込み署名を有効にしてください",
    });
  const [c] = await tx
    .select()
    .from(s.securityChallenge)
    .where(
      and(
        eq(s.securityChallenge.id, proof.id),
        eq(s.securityChallenge.userId, uid),
        eq(s.securityChallenge.sessionId, sid),
        eq(s.securityChallenge.kind, "write"),
        gt(s.securityChallenge.expiresAtMs, Date.now()),
      ),
    );
  if (!c || c.payloadHash !== (await operationHash(input))) throw new ORPCError("UNAUTHORIZED");
  const [identity] = await tx.select().from(s.writeIdentity).where(eq(s.writeIdentity.userId, uid));
  if (!identity || identity.generation !== input.generation) throw new ORPCError("UNAUTHORIZED");
  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(identity.publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new Uint8Array(Buffer.from(proof.signature, "base64")),
      new TextEncoder().encode(
        signingMessage({
          id: c.id,
          userId: uid,
          sessionId: sid,
          payloadHash: c.payloadHash,
          expiresAtMs: c.expiresAtMs,
        }),
      ),
    );
  } catch {}
  if (!valid) throw new ORPCError("UNAUTHORIZED");
  const consumed = await tx
    .delete(s.securityChallenge)
    .where(eq(s.securityChallenge.id, c.id))
    .returning();
  if (consumed.length !== 1) throw new ORPCError("UNAUTHORIZED");
}
