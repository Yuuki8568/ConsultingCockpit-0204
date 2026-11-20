import { createClient } from '@libsql/client/web';
const EXPECTED_SITE='https://cockpit.yamashirogyomukaizen.com';
export const RECEIPT='hardening-20261101-v1';
export const requiredTables=['security_counter','record_revision','passkey_credential','security_challenge','step_up_ticket','device_session','write_identity','audit_head'];
export async function applyOnce(client:ReturnType<typeof createClient>,migration:string){
 const result=await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
 const names=new Set(result.rows.map(r=>String(r.name)));
 if(!['vault','record','audit_event'].every(n=>names.has(n)))throw new Error('SCHEMA_MISMATCH');
 const existing=requiredTables.filter(n=>names.has(n));
 if(existing.length!==0&&existing.length!==requiredTables.length)throw new Error('PARTIAL_SCHEMA');
 if(existing.length===0)await client.executeMultiple(migration);
 const after=await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
 const columns=await client.execute('PRAGMA table_info(audit_event)');
 if(!requiredTables.every(n=>after.rows.some(r=>r.name===n))||!columns.rows.some(r=>r.name==='hash_version'))throw new Error('VALIDATION_FAILED');
 return existing.length===0?'applied':'already-applied';
}
// This file is bundled with the reviewed additive SQL injected at build time.
declare const HARDENING_SQL:string;
export default {
 async fetch(){return new Response('Cockpitは安全対策の切り替え中です。少し待って再読み込みしてください。端末内の未送信データは保持されます。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Retry-After':'60'}});},
 async scheduled(_controller:unknown,env:{MIGRATION_RECEIPT:{prepare(sql:string):{bind(...args:unknown[]):{first():Promise<unknown>;run():Promise<unknown>}}}}){
  const exists=await env.MIGRATION_RECEIPT.prepare('SELECT id FROM migration_receipt WHERE id=? AND status=?').bind(RECEIPT,'complete').first();if(exists)return;
  let client:ReturnType<typeof createClient>|undefined;
  try{
   if(process.env.WEBSITE_URL!==EXPECTED_SITE||!process.env.DATABASE_URL?.startsWith('libsql://')||!process.env.DATABASE_AUTH_TOKEN)throw new Error('CONFIGURATION_MISMATCH');
   client=createClient({url:process.env.DATABASE_URL,authToken:process.env.DATABASE_AUTH_TOKEN});
   await applyOnce(client,HARDENING_SQL);
   await env.MIGRATION_RECEIPT.prepare('INSERT INTO migration_receipt(id,status,at_ms) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,at_ms=excluded.at_ms').bind(RECEIPT,'complete',Date.now()).run();
  }catch{
   await env.MIGRATION_RECEIPT.prepare('INSERT INTO migration_receipt(id,status,at_ms) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,at_ms=excluded.at_ms').bind(RECEIPT,'failed',Date.now()).run();
  }finally{client?.close();}
 }
};
