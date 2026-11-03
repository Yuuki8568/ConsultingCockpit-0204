// Synthetic identities only. No network, OAuth, production binding or real passkeys.
const assert=require('node:assert/strict'),fs=require('node:fs');
const dep=require('node:module').createRequire(require.resolve('wrangler'));
const {build}=dep('esbuild'),{Miniflare,convertV4MiniflareOptions}=dep('miniflare');
(async()=>{
 const b=await build({stdin:{contents:`export {mutateVaultD1,unlockParamsD1} from './packages/web/src/api/database/d1/vault.ts';export {operationHash} from './packages/web/src/shared/operation-proof.ts'`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
 const {mutateVaultD1,unlockParamsD1,operationHash}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-10-17',d1Databases:['DB']}));
 try{
 const db=await mf.getD1Database('DB');
 await db.batch((fs.readFileSync('cloudflare/d1/business-schema.sql','utf8')+fs.readFileSync('cloudflare/d1/schema.sql','utf8')).replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 const run=(sql,...args)=>db.prepare(sql).bind(...args).run(),one=(sql,...args)=>db.prepare(sql).bind(...args).first();
 const now=Date.now(),p={userId:'owner',sessionId:'mac-session'};
 await run('INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)','owner','test','test@example.invalid',now,now);
 async function session(id){await run('INSERT INTO session(id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)',id,now+3600000,id+'-token',now,now,'owner');}
 await session(p.sessionId);
 async function proof(action,input,sid=p.sessionId){const id=crypto.randomUUID();await run('INSERT INTO step_up_ticket(id,user_id,session_id,action,payload_hash,expires_at_ms) VALUES (?,?,?,?,?,?)',id,'owner',sid,action,await operationHash(input),Date.now()+60000);return {...input,authorization:id}}
 const cipher=Buffer.alloc(32,1).toString('base64'),iv=Buffer.alloc(12,2).toString('base64');
 const input={kdfSalt:cipher,kdfIterations:600000,verifierCiphertext:cipher,verifierIv:iv};
 await assert.rejects(mutateVaultD1(db,p,'vault:create',input));
 const create=await proof('vault:create',input);await mutateVaultD1(db,p,'vault:create',create);
 await assert.rejects(mutateVaultD1(db,p,'vault:create',create));
 const results=await Promise.allSettled(Array.from({length:25},()=>unlockParamsD1(db,p)));
 assert.ok(results.filter(r=>r.status==='fulfilled').length<=20);
 assert.equal((await one('SELECT count FROM security_counter WHERE key=?','unlock:owner')).count,21);
 assert.equal((await one("SELECT count(*) n FROM login_event WHERE kind='server_throttle'")).n,5);
 await run('DELETE FROM login_event WHERE user_id=?','owner');
 await assert.rejects(unlockParamsD1(db,p)); // history deletion cannot reset the limit
 // New module instance / request keeps the same durable limit.
 await assert.rejects(unlockParamsD1(db,{...p}));
 assert.equal((await one("SELECT count(*) n FROM login_event WHERE kind='server_throttle'")).n,2);
 await run('INSERT INTO record(id,user_id,type,ciphertext,iv,updated_at_ms,version,seq) VALUES (?,?,?,?,?,?,1,1)','case','owner','case',cipher,iv,now);
 await run('INSERT INTO record_revision(id,user_id,record_id,archived_at_ms,snapshot) VALUES (?,?,?,?,?)','old','owner','case',now,'synthetic-encrypted-snapshot');
 const erase=await proof('vault:erase',{confirm:'ERASE'});
 await db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 await assert.rejects(mutateVaultD1(db,p,'vault:erase',erase));
 assert.equal((await one('SELECT count(*) n FROM record')).n,1);assert.equal((await one('SELECT count(*) n FROM vault')).n,1);
 assert.ok(await one('SELECT id FROM step_up_ticket WHERE id=?',erase.authorization));
 await db.exec('DROP TRIGGER reject_audit');
 await mutateVaultD1(db,p,'vault:erase',erase);
 for(const table of ['record','record_revision','vault','write_identity'])assert.equal((await one('SELECT count(*) n FROM '+table)).n,0);
 assert.equal((await one('SELECT count FROM security_counter WHERE key=?','unlock:owner')).count,21);
 assert.equal((await one('SELECT count(*) n FROM audit_event')).n,2);
 assert.equal((await one('SELECT count(*) n FROM login_event')).n,2);
 assert.equal((await one('SELECT count(*) n FROM session')).n,1);
 assert.equal((await one('SELECT count(*) n FROM cockpit_atomic_assertion')).n,0);
 console.log('PASS D1 vault: protected creation/erasure, replay refusal, concurrent unlock limit, history deletion resistance, refusal logging, erase rollback, preserved security state');
 }finally{await mf.dispose()}
})().catch(e=>{console.error(e);process.exitCode=1});
