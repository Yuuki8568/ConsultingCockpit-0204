/** D1 candidate; caller must authenticate owner and Origin before invoking. */
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ORPCError } from "@orpc/server";
import * as s from "../schema";
import { saltInput, ciphertextInput, ivInput } from "../../security/inputs";
import { operationHash } from "../../../shared/operation-proof";
import { atomicCheckedBatch } from "../../../../../../cloudflare/d1/atomic-batch";
import { sessionGuard, type AuthPrincipal } from "./authorization";
import { auditPlanD1 } from "./audit-plan";

export async function unlockParamsD1(d1: D1Database, p: AuthPrincipal) {
  const now = Date.now(),
    window = Math.floor(now / 900000) * 900000,
    key = `unlock:${p.userId}`;
  // Log refusal in the same committed batch as the counter; throw only afterwards.
  await atomicCheckedBatch(d1, [
    sessionGuard(d1, p),
    {
      statement: d1
        .prepare(
          `INSERT INTO security_counter(key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN security_counter.window_start=excluded.window_start THEN min(security_counter.count+1,21) ELSE 1 END`,
        )
        .bind(key, window),
      expectedChanges: 1,
    },
    {
      statement: d1
        .prepare(
          `INSERT INTO login_event(id,user_id,at_ms,kind) SELECT ?,?,?,CASE WHEN count<=20 THEN 'unlock_params' ELSE 'server_throttle' END FROM security_counter WHERE key=?`,
        )
        .bind(crypto.randomUUID(), p.userId, now, key),
      expectedChanges: 1,
    },
  ]);
  // Read with a fresh session guard and condition on the durable counter. A concurrent
  // request may cause a conservative refusal, never an extra material disclosure.
  const [guard, result] = await d1.batch([
    sessionGuard(d1, p).statement,
    d1
      .prepare(
        `SELECT kdf_salt AS kdfSalt,kdf_algo AS kdfAlgo,kdf_iterations AS kdfIterations,verifier_ciphertext AS verifierCiphertext,verifier_iv AS verifierIv,generation FROM vault WHERE user_id=? AND EXISTS(SELECT 1 FROM security_counter WHERE key=? AND window_start=? AND count<=20)`,
      )
      .bind(p.userId, key, window),
  ]);
  if (guard.meta.changes !== 1) throw new ORPCError("UNAUTHORIZED");
  if (!result.results[0]) {
    const counter = await d1
      .prepare("SELECT count FROM security_counter WHERE key=?")
      .bind(key)
      .first<{ count: number }>();
    if (counter && counter.count > 20) throw new ORPCError("TOO_MANY_REQUESTS");
    throw new ORPCError("NOT_FOUND");
  }
  return result.results[0];
}

export async function mutateVaultD1(
  d1: D1Database,
  p: AuthPrincipal,
  action: "vault:create" | "vault:erase",
  raw: unknown,
) {
  const input =
    action === "vault:create"
      ? z
          .object({
            authorization: z.string().uuid().optional(),
            kdfSalt: saltInput,
            kdfIterations: z.number().int().min(100000).max(2000000),
            verifierCiphertext: ciphertextInput,
            verifierIv: ivInput,
          })
          .parse(raw)
      : z
          .object({ confirm: z.literal("ERASE"), authorization: z.string().uuid().optional() })
          .parse(raw);
  if (!input.authorization) throw new ORPCError("UNAUTHORIZED");
  const q = drizzle(d1, { schema: s }),
    uid = p.userId;
  const [binding] = await q
    .select()
    .from(s.deviceSession)
    .where(eq(s.deviceSession.sessionId, p.sessionId));
  const ops = [
    sessionGuard(d1, p),
    {
      statement: d1
        .prepare(
          `DELETE FROM step_up_ticket WHERE id=? AND user_id=? AND session_id=? AND action=? AND payload_hash=? AND expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)`,
        )
        .bind(input.authorization, uid, p.sessionId, action, await operationHash(input)),
      expectedChanges: 1,
    },
  ];
  if ("kdfSalt" in input) {
    const now = Date.now(),
      x = q
        .insert(s.vault)
        .values({
          userId: uid,
          kdfSalt: input.kdfSalt,
          kdfAlgo: "PBKDF2-SHA256",
          kdfIterations: input.kdfIterations,
          verifierCiphertext: input.verifierCiphertext,
          verifierIv: input.verifierIv,
          generation: 1,
          createdAtMs: now,
          updatedAtMs: now,
        })
        .toSQL();
    ops.push({ statement: d1.prepare(x.sql).bind(...x.params), expectedChanges: 1 });
  } else {
    // Fixed internal allowlist. No caller-provided SQL identifiers. Security state survives.
    const tables = ["record", "record_revision", "write_identity", "vault"] as const;
    const counts = await d1.batch<{ n: number }>(
      tables.map((t) => d1.prepare(`SELECT count(*) n FROM ${t} WHERE user_id=?`).bind(uid)),
    );
    tables.forEach((t, i) =>
      ops.push({
        statement: d1.prepare(`DELETE FROM ${t} WHERE user_id=?`).bind(uid),
        expectedChanges: counts[i].results[0].n,
      }),
    );
  }
  ops.push(...(await auditPlanD1(d1, uid, binding?.deviceId ?? null, action)));
  try {
    await atomicCheckedBatch(d1, ops);
  } catch {
    throw new ORPCError("CONFLICT");
  }
  return action === "vault:create" ? { ok: true, generation: 1 } : { ok: true };
}
