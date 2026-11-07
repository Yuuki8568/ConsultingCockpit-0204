/** Candidate request-local auth adapter; production still uses the libSQL context. */
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { createAuth } from "../../auth";
import * as schema from "../schema";
import { isAllowedOrigin } from "../../origins";
import { isOwnerEmail } from "../../owner";
import { ORPCError } from "@orpc/server";

export function createD1Auth(d1: D1Database) {
  return createAuth(drizzle(d1, { schema }));
}

/** Entry guard for future D1 RPC routing. Never trust a client-supplied user/session ID. */
export async function authenticateD1(d1: D1Database, headers: Headers) {
  if (!isAllowedOrigin(headers.get("origin"))) throw new ORPCError("FORBIDDEN");
  const login = await createD1Auth(d1).api.getSession({ headers });
  if (!login) throw new ORPCError("UNAUTHORIZED");
  if (!login.user.emailVerified || !isOwnerEmail(login.user.email))
    throw new ORPCError("FORBIDDEN");
  const row = await d1
    .prepare(`SELECT b.user_id,b.device_id,d.revoked_at_ms,d.id AS existing_device
 FROM device_session b LEFT JOIN device d ON d.id=b.device_id AND d.user_id=b.user_id
 WHERE b.session_id=?`)
    .bind(login.session.id)
    .first<{
      user_id: string;
      device_id: string;
      revoked_at_ms: number | null;
      existing_device: string | null;
    }>();
  if (row && (row.user_id !== login.user.id || !row.existing_device || row.revoked_at_ms !== null))
    throw new ORPCError("FORBIDDEN");
  return { user: login.user, session: login.session, deviceId: row?.device_id ?? null };
}
