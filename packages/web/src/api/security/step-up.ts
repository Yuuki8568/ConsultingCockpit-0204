import { ORPCError } from "@orpc/server";
import { and, eq, gt } from "drizzle-orm";
import { operationHash } from "../../shared/operation-proof";
import * as schema from "../database/schema";
import type { Transaction } from "./controls";
export function approvedFingerprint(fingerprint: string) {
  try {
    const list = JSON.parse(process.env.COCKPIT_APPROVED_PASSKEYS ?? "[]");
    return Array.isArray(list) && list.includes(fingerprint);
  } catch {
    return false;
  }
}
export async function requireStepUp(
  tx: Transaction,
  uid: string,
  sessionId: string,
  action: string,
  payload: unknown,
  ticket?: string,
) {
  if (!ticket)
    throw new ORPCError("UNAUTHORIZED", {
      message: "この操作にはパスキーによる本人確認が必要です",
    });
  const hash = await operationHash(payload);
  const rows = await tx
    .delete(schema.stepUpTicket)
    .where(
      and(
        eq(schema.stepUpTicket.id, ticket),
        eq(schema.stepUpTicket.userId, uid),
        eq(schema.stepUpTicket.sessionId, sessionId),
        eq(schema.stepUpTicket.action, action),
        eq(schema.stepUpTicket.payloadHash, hash),
        gt(schema.stepUpTicket.expiresAtMs, Date.now()),
      ),
    )
    .returning();
  if (rows.length !== 1)
    throw new ORPCError("UNAUTHORIZED", {
      message: "本人確認の有効期限が切れたか、操作内容が変更されました",
    });
}
