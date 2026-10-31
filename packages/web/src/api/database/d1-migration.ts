import type { D1Database } from '@cloudflare/workers-types';

export type MigrationRow = { table: string; payload: string };
export const MAX_ROWS = 1000;
export const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ROW_BYTES = 1500 * 1024;
const TABLES = new Set(['vault', 'record', 'device', 'audit_event', 'login_event']);

export function validateMigrationRows(rows: MigrationRow[]) {
  if (!rows.length || rows.length > MAX_ROWS) throw new Error('移行データ件数が今回の検証上限を超えています。');
  let bytes = 0;
  for (const r of rows) {
    if (!TABLES.has(r.table)) throw new Error('対象外のテーブルです。');
    const size = new TextEncoder().encode(r.payload).byteLength;
    if (size > MAX_ROW_BYTES) throw new Error('大きなレコードがあります。分割移行が必要です。');
    bytes += size;
  }
  if (bytes > MAX_BYTES) throw new Error('移行データ容量が今回の検証上限を超えています。');
}
export async function migrationDigest(rows: MigrationRow[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(rows));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}

/** Immutable, owner-scoped candidate. It NEVER changes the authoritative database. */
export async function stageEncryptedSnapshot(d1: D1Database, userId: string, rows: MigrationRow[]) {
  validateMigrationRows(rows);
  const digest = await migrationDigest(rows);
  const id = crypto.randomUUID();
  // Atomic rate guard avoids simultaneous/accidental repeated copies.
  const started = await d1.prepare(`INSERT INTO cockpit_migration_run
    (id,user_id,created_at,status,row_count,digest)
    SELECT ?,?,?,'copying',?,? WHERE NOT EXISTS
    (SELECT 1 FROM cockpit_migration_run WHERE user_id=? AND created_at>?)`)
    .bind(id, userId, Date.now(), rows.length, digest, userId, Date.now() - 300000).run();
  if (!started.meta.changes) throw new Error('直前の移行コピーがあります。5分後に再試行してください。');
  try {
    for (let i = 0; i < rows.length; i += 20) {
      await d1.batch(rows.slice(i, i + 20).map((r, n) => d1.prepare(
        'INSERT INTO cockpit_migration_row (run_id,ordinal,table_name,payload) VALUES (?,?,?,?)'
      ).bind(id, i + n, r.table, r.payload)));
    }
    const read = await d1.prepare(`SELECT table_name,payload FROM cockpit_migration_row
      WHERE run_id=? ORDER BY ordinal`).bind(id).all<{table_name:string;payload:string}>();
    const restored = read.results.map(r => ({table:r.table_name,payload:r.payload}));
    if (restored.length !== rows.length || await migrationDigest(restored) !== digest)
      throw new Error('D1への保存内容が移行元と一致しません。本番切替は行いません。');
    await d1.prepare("UPDATE cockpit_migration_run SET status='verified' WHERE id=? AND user_id=?")
      .bind(id,userId).run();
    return {id, count:rows.length, verified:true as const, backendChanged:false as const};
  } catch (error) {
    await d1.prepare("UPDATE cockpit_migration_run SET status='failed' WHERE id=? AND user_id=?")
      .bind(id,userId).run().catch(() => {});
    throw error;
  }
}
