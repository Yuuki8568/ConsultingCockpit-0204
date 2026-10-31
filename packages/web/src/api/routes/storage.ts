import { ORPCError } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { db, databaseContext } from '../database';
import * as s from '../database/schema';
import { authed, recentlyAuthed } from '../middleware/auth';
import { MAX_ROWS, stageEncryptedSnapshot, type MigrationRow } from '../database/d1-migration';

export const storage = {
  status: authed.handler(async ({context}) => {
    const target = databaseContext.getStore()?.migrationDb;
    if (!target) return {available:false, activeBackend:'libsql' as const, latest:null};
    const latest = await target.prepare(`SELECT id,created_at,status,row_count FROM cockpit_migration_run
      WHERE user_id=? ORDER BY created_at DESC LIMIT 1`).bind(context.user.id)
      .first<{id:string;created_at:number;status:string;row_count:number}>();
    return {available:true,activeBackend:'libsql' as const,latest};
  }),
  stage: recentlyAuthed.handler(async ({context}) => {
    const target = databaseContext.getStore()?.migrationDb;
    if (!target) throw new ORPCError('SERVICE_UNAVAILABLE',{message:'D1移行先が未設定です。'});
    // Consistent source snapshot. Only ciphertext and existing operational metadata.
    // No password, decrypted business content, session or OAuth token is copied.
    const rows = await db.transaction(async tx => {
      const result: MigrationRow[] = [];
      const tables = [s.vault,s.record,s.device,s.auditEvent,s.loginEvent] as const;
      const names = ['vault','record','device','audit_event','login_event'];
      for (let n=0;n<tables.length;n++) {
        const table=tables[n]!;
        const values = await tx.select().from(table).where(eq(table.userId,context.user.id)).limit(MAX_ROWS+1);
        if (n===0 && values.length!==1) throw new ORPCError('NOT_FOUND',{message:'同期先の金庫を取得できません。本番切替は行いません。'});
        for(const value of values) result.push({table:names[n]!,payload:JSON.stringify(value)});
        if(result.length>MAX_ROWS) throw new ORPCError('BAD_REQUEST',{message:'移行対象が多いため分割移行が必要です。'});
      }
      return result;
    });
    try { return await stageEncryptedSnapshot(target,context.user.id,rows); }
    catch { throw new ORPCError('INTERNAL_SERVER_ERROR',{message:'D1コピーを完了できませんでした。直前の実行から5分以上空けて再試行してください。現行の保存先は変更していません。'}); }
  }),
};
