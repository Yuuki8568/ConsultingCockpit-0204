// Synthetic identities only. No network, OAuth, production binding or real passkeys.
const assert=require('node:assert/strict'),fs=require('node:fs');
const dep=require('node:module').createRequire(require.resolve('wrangler'));
const {build}=dep('esbuild'),{Miniflare,convertV4MiniflareOptions}=dep('miniflare');
(async()=>{
 const b=await build({stdin:{contents:`export {mutateDeviceD1} from './packages/web/src/api/database/d1/devices.ts';export {operationHash} from './packages/web/src/shared/operation-proof.ts'`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
 const {mutateDeviceD1,operationHash}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
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
 const reg={id:'mac-device',label:'Mac',platform:'macOS'};
 await assert.rejects(mutateDeviceD1(db,p,'device:register',reg));
 const initial=await proof('device:register',reg);await mutateDeviceD1(db,p,'device:register',initial);
 assert.equal((await one('SELECT device_id FROM device_session WHERE session_id=?',p.sessionId)).device_id,reg.id);
 assert.equal(await one('SELECT id FROM step_up_ticket WHERE id=?',initial.authorization),null);
 // Bound repeat only updates labels, never creates another binding or audit noise.
 await mutateDeviceD1(db,p,'device:register',{...reg,label:'Mac renamed'});
 assert.equal((await one('SELECT count(*) n FROM audit_event')).n,1);
 await assert.rejects(mutateDeviceD1(db,p,'device:register',await proof('device:register',{...reg,id:'changed-device'})));
 await session('android-session');
 const android={id:'android-device',label:'Android',platform:'Android'};
 await mutateDeviceD1(db,{...p,sessionId:'android-session'},'device:register',await proof('device:register',android,'android-session'));
 const revoke=await proof('device:revoke',{id:android.id});
 // A late audit failure rolls back revocation, session deletion and proof consumption.
 await db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 await assert.rejects(mutateDeviceD1(db,p,'device:revoke',revoke));
 assert.equal((await one('SELECT revoked_at_ms FROM device WHERE id=?',android.id)).revoked_at_ms,null);
 assert.ok(await one('SELECT id FROM session WHERE id=?','android-session'));
 assert.ok(await one('SELECT id FROM step_up_ticket WHERE id=?',revoke.authorization));
 await db.exec('DROP TRIGGER reject_audit');
 await mutateDeviceD1(db,p,'device:revoke',revoke);
 assert.ok((await one('SELECT revoked_at_ms FROM device WHERE id=?',android.id)).revoked_at_ms);
 assert.equal(await one('SELECT id FROM session WHERE id=?','android-session'),null);
 assert.ok((await one('SELECT expires_at FROM session WHERE id=?',p.sessionId)).expires_at>now);
 await assert.rejects(mutateDeviceD1(db,p,'device:revoke',revoke));
 await session('android-new');
 await assert.rejects(mutateDeviceD1(db,{...p,sessionId:'android-new'},'device:register',await proof('device:register',android,'android-new')));
 const wrong=await proof('device:revoke',{id:android.id});await assert.rejects(mutateDeviceD1(db,p,'device:unrevoke',wrong));
 await mutateDeviceD1(db,p,'device:unrevoke',await proof('device:unrevoke',{id:android.id}));
 await mutateDeviceD1(db,{...p,sessionId:'android-new'},'device:register',await proof('device:register',android,'android-new'));
 await mutateDeviceD1(db,p,'device:remove',await proof('device:remove',{id:android.id}));
 assert.ok(await one('SELECT id FROM device WHERE id=?',android.id)); // tombstone survives removal
 await assert.rejects(mutateDeviceD1(db,{userId:'outsider',sessionId:p.sessionId},'device:register',reg));
 // Expiry and revocation are checked at COMMIT, not just at the initial read.
 const restore=await proof('device:unrevoke',{id:android.id});let n=0;
 const expired=new Proxy(db,{get(t,k){if(k==='batch')return async statements=>{if(++n===2)await run('UPDATE session SET expires_at=0 WHERE id=?',p.sessionId);return t.batch(statements)};const v=t[k];return typeof v==='function'?v.bind(t):v}});
 await assert.rejects(mutateDeviceD1(expired,p,'device:unrevoke',restore));
 assert.ok(await one('SELECT id FROM step_up_ticket WHERE id=?',restore.authorization));
 await run('UPDATE session SET expires_at=? WHERE id=?',now+3600000,p.sessionId);
 // Concurrent new login must not survive a successful revocation.
 const race=await proof('device:revoke',{id:android.id});n=0;
 const loginRace=new Proxy(db,{get(t,k){if(k==='batch')return async statements=>{if(++n===2)await session('racing-session');return t.batch(statements)};const v=t[k];return typeof v==='function'?v.bind(t):v}});
 await assert.rejects(mutateDeviceD1(loginRace,p,'device:revoke',race));
 assert.ok(await one('SELECT id FROM step_up_ticket WHERE id=?',race.authorization));
 // Revoking the current device removes its own session too.
 await mutateDeviceD1(db,p,'device:revoke',await proof('device:revoke',{id:reg.id}));
 assert.equal((await one('SELECT count(*) n FROM session')).n,0);
 assert.equal((await one('SELECT count(*) n FROM cockpit_atomic_assertion')).n,0);
 console.log('PASS D1 devices: registration, bound heartbeat, immutable ID, Mac/Android synthetic sessions, revoke/remove tombstones, explicit recovery, replay/scope/tenant rejection, audit rollback, commit-time expiry, concurrent login, self-revocation');
 }finally{await mf.dispose()}
})().catch(e=>{console.error(e);process.exitCode=1});
