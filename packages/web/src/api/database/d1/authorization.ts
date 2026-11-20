import type { D1Database } from "@cloudflare/workers-types";
import { ORPCError } from "@orpc/server";
export type AuthPrincipal = { userId: string; sessionId: string };
/** Recheck the live session and any device binding at commit time, including first enrollment. */
export function sessionGuard(d1: D1Database, p: AuthPrincipal) {
  return {
    statement: d1
      .prepare(`UPDATE session SET updated_at=updated_at WHERE id=? AND user_id=?
 AND expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)
 AND NOT EXISTS(SELECT 1 FROM device_session b LEFT JOIN device d ON d.id=b.device_id AND d.user_id=b.user_id
 WHERE b.session_id=? AND (b.user_id<>? OR d.id IS NULL OR d.revoked_at_ms IS NOT NULL))`)
      .bind(p.sessionId, p.userId, p.sessionId, p.userId),
    expectedChanges: 1,
  };
}
/** Independent durable counters: rejected requests must not roll them back. */
export async function consumeD1Limit(d1: D1Database, key: string, limit: number, windowMs: number) {
  const start = Math.floor(Date.now() / windowMs) * windowMs;
  const r = await d1
    .prepare(`INSERT INTO security_counter(key,window_start,count) VALUES (?,?,1)
 ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN security_counter.window_start=excluded.window_start THEN min(security_counter.count+1,?) ELSE 1 END RETURNING count`)
    .bind(key, start, limit + 1)
    .first<{ count: number }>();
  if (!r || r.count > limit) throw new ORPCError("TOO_MANY_REQUESTS");
}
