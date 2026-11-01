// Explicit maintenance operation only; never run during application startup.
// Credentials come from the existing CI secret JSON and are never printed.
const fs=require('node:fs');
const {createClient}=require('@libsql/client');
(async()=>{
 if(process.env.CONFIRM_HARDENING_MIGRATION!=='20261101')throw new Error('Explicit migration confirmation required');
 const config=JSON.parse(process.env.CLOUDFLARE_RUNTIME_SECRETS||'{}');
 if(!config.DATABASE_URL||!config.DATABASE_AUTH_TOKEN)throw new Error('Existing database configuration is unavailable');
 if(!/^libsql:\/\//.test(config.DATABASE_URL))throw new Error('Expected the existing libSQL database');
 const client=createClient({url:config.DATABASE_URL,authToken:config.DATABASE_AUTH_TOKEN});
 try{
  const existing=await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('vault','record','audit_event','security_counter')");
  const names=new Set(existing.rows.map(r=>r.name));
  if(!['vault','record','audit_event'].every(n=>names.has(n))||names.has('security_counter'))throw new Error('Unexpected schema or migration already applied');
  await client.executeMultiple(fs.readFileSync('security-ops/migrations/20261101-hardening.sql','utf8'));
  console.log('Hardening schema migration completed; no business content was read or printed.');
 }finally{client.close();}
})().catch(()=>{console.error('Hardening migration failed. No credentials or database error details are printed. Inspect schema safely before retrying.');process.exitCode=1;});
