import type {D1Database, D1PreparedStatement} from '@cloudflare/workers-types';
/** Internal migration building block, NOT an RPC or a replacement for auth.
 * The caller must verify signatures and compile trusted SQL; no user SQL accepted.
 * Requires schema.sql in the target. Never fall back to sequential .run().
 */
export async function atomicCheckedBatch(db: D1Database, mutations: {
  statement: D1PreparedStatement; expectedChanges: number;
}[]) {
  if (!mutations.length || mutations.length > 64 || mutations.some(m =>
    !Number.isSafeInteger(m.expectedChanges) || m.expectedChanges < 0)) {
    throw new Error('Invalid atomic batch plan');
  }
  const token = crypto.randomUUID();
  const statements = mutations.flatMap((m, i) => [
    m.statement,
    db.prepare('INSERT INTO cockpit_atomic_assertion (id, ok) VALUES (?, CASE WHEN changes() = ? THEN 1 ELSE 0 END)')
      .bind(`${token}:${i}`, m.expectedChanges),
  ]);
  statements.push(db.prepare('DELETE FROM cockpit_atomic_assertion WHERE id LIKE ?').bind(`${token}:%`));
  // CHECK failure rolls back prior changes, archives and consumed challenges.
  await db.batch(statements);
}
