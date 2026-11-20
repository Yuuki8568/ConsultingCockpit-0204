// Synthetic accounts, ciphertext and signatures only; no production binding.
const assert=require('node:assert/strict'),fs=require('node:fs');
const dep=require('node:module').createRequire(require.resolve('wrangler'));
const {build}=dep('esbuild'),{Miniflare,convertV4MiniflareOptions}=dep('miniflare');
(async()=>{
 const b=await build({stdin:{contents:`export {pushD1} from './packages/web/src/api/database/d1/sync.ts';export {rekeyD1} from './packages/web/src/api/database/d1/rekey.ts';export {operationHash,signingMessage} from './packages/web/src/shared/operation-proof.ts'`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
 const {pushD1,rekeyD1,operationHash,signingMessage}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-10-17',d1Databases:['DB']}));
 try{
 const db=await mf.getD1Database('DB');
 const sql=fs.readFileSync('cloudflare/d1/business-schema.sql','utf8')+'\n'+fs.readFileSync('cloudflare/d1/schema.sql','utf8');
 await db.batch(sql.replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 const run=(sql,...args)=>db.prepare(sql).bind(...args).run(),one=(sql,...args)=>db.prepare(sql).bind(...args).first();
 const now=Date.now(),cipher=n=>Buffer.alloc(32,n).toString('base64'),iv=Buffer.alloc(12,1).toString('base64');
 for(const uid of ['owner','outsider']){
 await run('INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)',uid,uid,uid+'@example.invalid',now,now);
 await run('INSERT INTO session(id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)',uid+'-session',now+3600000,uid+'-token',now,now,uid);
 await run('INSERT INTO device(id,user_id,label,platform,created_at_ms,last_seen_at_ms) VALUES (?,?,?,?,?,?)',uid+'-device',uid,'synthetic','test',now,now);
 await run('INSERT INTO device_session(session_id,user_id,device_id,created_at_ms) VALUES (?,?,?,?)',uid+'-session',uid,uid+'-device',now);
 await run('INSERT INTO vault(user_id,kdf_salt,verifier_ciphertext,verifier_iv,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?)',uid,cipher(1),cipher(2),iv,now,now);
 }
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const pub=JSON.stringify(await crypto.subtle.exportKey('jwk',pair.publicKey));
 await run('INSERT INTO write_identity(user_id,public_key,private_ciphertext,private_iv,generation,version) VALUES (?,?,?,?,1,1)','owner',pub,cipher(3),iv);
 const principal={userId:'owner',sessionId:'owner-session',deviceId:'owner-device'};
 const record=(id,baseSeq=0,n=4)=>({operation:'put',id,type:'case',ciphertext:cipher(n),iv,updatedAtMs:now,deleted:false,baseSeq});
 const request=records=>({deviceId:'owner-device',generation:1,since:0,records});
 async function signed(input,lifetimeMs=300000){
 const c={id:crypto.randomUUID(),userId:'owner',sessionId:'owner-session',payloadHash:await operationHash(input),expiresAtMs:Date.now()+lifetimeMs};
 await run("INSERT INTO security_challenge(id,user_id,session_id,kind,challenge,action,payload_hash,expires_at_ms) VALUES (?,?,?,'write','','sync:push',?,?)",c.id,c.userId,c.sessionId,c.payloadHash,c.expiresAtMs);
 const signature=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(signingMessage(c)))).toString('base64');
 return {...input,proof:{id:c.id,signature}};
 }
 await assert.rejects(pushD1(db,principal,request([record('a')])));
 await assert.rejects(pushD1(db,principal,await signed(request([record('a')]),-1000))); // expired proof
 const first=await signed(request([record('a')]));const saved=await pushD1(db,principal,first);
 assert.deepEqual(saved.accepted,['a']);assert.equal(saved.changed[0].ciphertext,cipher(4));
 await assert.rejects(pushD1(db,principal,first)); // replay
 const tampered=await signed(request([record('a',saved.acceptedVersions.a,5)]));tampered.records[0].ciphertext=cipher(6);await assert.rejects(pushD1(db,principal,tampered));
 const left=await signed(request([record('a',saved.acceptedVersions.a,7)])),right=await signed(request([record('a',saved.acceptedVersions.a,8)]));
 const race=await Promise.allSettled([pushD1(db,principal,left),pushD1(db,principal,right)]);
 const winners=race.filter(r=>r.status==='fulfilled'&&r.value.accepted.includes('a'));assert.equal(winners.length,1,JSON.stringify(race.map(r=>r.status==='rejected'?{status:r.status,code:r.reason?.code,message:r.reason?.message}:{status:r.status,accepted:r.value.accepted,conflicts:r.value.conflicts.length})));
 assert.equal((await one('SELECT count(*) n FROM record_revision')).n,1);
 assert.equal((await one('SELECT count(*) n FROM audit_event')).n,2);
 const old=await signed(request([record('a',saved.acceptedVersions.a,9)]));const conflict=await pushD1(db,principal,old);
 assert.equal(conflict.conflicts.length,1);assert.equal(conflict.accepted.length,0);
 const current=await one('SELECT seq,ciphertext FROM record WHERE id=?','a');
 // Later SQL failure rolls back challenge consumption, history, record and audit.
 const rollback=await signed(request([record('a',current.seq,10)]));
 await db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 await assert.rejects(pushD1(db,principal,rollback));
 assert.equal((await one('SELECT seq FROM record WHERE id=?','a')).seq,current.seq);
 assert.ok(await one('SELECT id FROM security_challenge WHERE id=?',rollback.proof.id));
 assert.equal((await one('SELECT count(*) n FROM record_revision')).n,1);
 await db.exec('DROP TRIGGER reject_audit');
 await assert.rejects(pushD1(db,{...principal,userId:'outsider'},await signed(request([record('b')]))));
 const revoke=await signed(request([record('b')]));await run('UPDATE device SET revoked_at_ms=? WHERE id=?',Date.now(),'owner-device');await assert.rejects(pushD1(db,principal,revoke));
 await run('UPDATE device SET revoked_at_ms=NULL WHERE id=?','owner-device');
 const during=await signed(request([record('b')]));let batches=0;
 const revokedDuringCommit=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{if(++batches===3)await run('UPDATE device SET revoked_at_ms=? WHERE id=?',Date.now(),'owner-device');return target.batch(statements)};const value=target[key];return typeof value==='function'?value.bind(target):value}});
 await assert.rejects(pushD1(revokedDuringCommit,principal,during));
 assert.equal(await one('SELECT id FROM record WHERE id=?','b'),null);
 assert.ok(await one('SELECT id FROM security_challenge WHERE id=?',during.proof.id));
 await run('UPDATE device SET revoked_at_ms=NULL WHERE id=?','owner-device');
 const stale=await signed(request([record('b')]));await run('UPDATE vault SET generation=2 WHERE user_id=?','owner');await assert.rejects(pushD1(db,principal,stale));
 await run('UPDATE vault SET generation=1 WHERE user_id=?','owner');
 const keyChange={expectedGeneration:1,kdfSalt:cipher(11),kdfIterations:600000,verifierCiphertext:cipher(12),verifierIv:iv,writeKey:{privateCiphertext:cipher(13),privateIv:iv,expectedVersion:1},records:[{id:'a',ciphertext:cipher(14),iv,baseSeq:current.seq}]};
 async function authorized(input){const id=crypto.randomUUID();await run('INSERT INTO step_up_ticket(id,user_id,session_id,action,payload_hash,expires_at_ms) VALUES (?,?,?,?,?,?)',id,'owner','owner-session','vault:rekey',await operationHash(input),Date.now()+60000);return {...input,authorization:id}}
 await assert.rejects(rekeyD1(db,principal,keyChange));
 const badChange=await authorized({...keyChange,records:[{...keyChange.records[0],baseSeq:0}]});await assert.rejects(rekeyD1(db,principal,badChange));
 const rollbackRekey=await authorized(keyChange);
 await db.exec("CREATE TRIGGER reject_rekey BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 await assert.rejects(rekeyD1(db,principal,rollbackRekey));
 assert.equal((await one('SELECT generation FROM vault WHERE user_id=?','owner')).generation,1);
 assert.equal((await one('SELECT generation FROM write_identity WHERE user_id=?','owner')).generation,1);
 assert.ok(await one('SELECT id FROM step_up_ticket WHERE id=?',rollbackRekey.authorization));
 await db.exec('DROP TRIGGER reject_rekey');
 const conflictRekey=await authorized(keyChange);let rekeyBatches=0;
 const changedDuringRekey=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{if(++rekeyBatches===2)await run('UPDATE record SET seq=seq+1 WHERE id=?','a');return target.batch(statements)};const value=target[key];return typeof value==='function'?value.bind(target):value}});
 await assert.rejects(rekeyD1(changedDuringRekey,principal,conflictRekey));
 assert.equal((await one('SELECT generation FROM vault WHERE user_id=?','owner')).generation,1);
 assert.ok(await one('SELECT id FROM step_up_ticket WHERE id=?',conflictRekey.authorization));
 await run('UPDATE record SET seq=? WHERE id=?',current.seq,'a');
 const change=await authorized(keyChange);assert.equal((await rekeyD1(db,principal,change)).generation,2);
 assert.equal((await one('SELECT ciphertext FROM record WHERE id=?','a')).ciphertext,cipher(14));
 assert.equal((await one('SELECT generation FROM write_identity WHERE user_id=?','owner')).generation,2);
 await assert.rejects(rekeyD1(db,principal,change));
 assert.equal((await rekeyD1(db,principal,await authorized(keyChange))).generation,2);
 assert.equal((await one('SELECT count(*) n FROM record WHERE user_id=?','outsider')).n,0);
 await run("WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<998) INSERT INTO record(id,user_id,type,ciphertext,iv,updated_at_ms,version,seq) SELECT 'limit-'||x,'owner','case',?,?,?,1,100+x FROM n",cipher(4),iv,now);
 // Ciphertext work is proportional to changes/page size, not account size.
 let ciphertextRows=0;
 const measured=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{const results=await target.batch(statements);for(const result of results)for(const row of result.results??[])if(row&&Object.hasOwn(row,'ciphertext')&&Object.hasOwn(row,'type'))ciphertextRows++;return results};const value=target[key];return typeof value==='function'?value.bind(target):value}});
 const deltaRequest=(since,records=[])=>({...request(records),generation:2,since});
 const settledCursor=(await one('SELECT max(seq) seq FROM record WHERE user_id=?','owner')).seq;
 const idle=await pushD1(measured,principal,deltaRequest(settledCursor));
 assert.deepEqual(idle.changed,[]);assert.equal(ciphertextRows,0);assert.equal(idle.hasMore,false);
 const edit=await signed(deltaRequest(settledCursor,[record('limit-0',100,15)]));
 const edited=await pushD1(measured,principal,edit);
 assert.deepEqual(edited.accepted,['limit-0']);assert.equal(ciphertextRows,1);assert.equal(edited.changed.length,1);
 // A pending local write must not make the pull cursor jump over unseen rows.
 ciphertextRows=0;
 const whilePaging=await pushD1(measured,principal,await signed(deltaRequest(0,[record('limit-1',101,16)])));
 assert.equal(whilePaging.hasMore,true);assert.equal(whilePaging.changed.length,256);
 assert.ok(whilePaging.cursor<whilePaging.acceptedVersions['limit-1']);
 assert.equal(ciphertextRows,257);
 let cursor=whilePaging.cursor,seen=new Set(whilePaging.changed.map(r=>r.id)),pages=1;
 while(true){const page=await pushD1(db,principal,deltaRequest(cursor));pages++;assert.ok(page.changed.length<=256);for(const row of page.changed)seen.add(row.id);assert.ok(page.cursor>=cursor);cursor=page.cursor;if(!page.hasMore)break;assert.ok(pages<10)}
 assert.equal(seen.size,1000);assert.equal(pages,4);
 // A read whose snapshot crosses another transaction is rejected, including
 // read-only sync (there is no audit append to provide an implicit CAS).
 let readBatches=0;
 const racedRead=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{if(++readBatches===3)await run('UPDATE record SET seq=(SELECT max(seq)+1 FROM record WHERE user_id=?) WHERE id=?','owner','a');return target.batch(statements)};const value=target[key];return typeof value==='function'?value.bind(target):value}});
 await assert.rejects(pushD1(racedRead,principal,deltaRequest(0)));
 // Keep legacy equal-sequence groups intact; never silently omit a tie.
 await run('UPDATE record SET seq=1 WHERE id LIKE ?','limit-%');
 await assert.rejects(pushD1(db,principal,deltaRequest(0)),e=>e.code==='PAYLOAD_TOO_LARGE');
 await run("UPDATE record SET seq=100+CAST(substr(id,7) AS INTEGER) WHERE id LIKE ?",'limit-%');
 // Byte-limited pages avoid loading hundreds of large ciphertext values.
 const bigCipher=Buffer.alloc(786432,17).toString('base64');
 await run("UPDATE record SET ciphertext=? WHERE id IN ('limit-0','limit-1','limit-2','limit-3')",bigCipher);
 ciphertextRows=0;
 const bytePage=await pushD1(measured,principal,deltaRequest(0));
 assert.equal(bytePage.changed.length,3);assert.equal(bytePage.hasMore,true);assert.equal(ciphertextRows,3);
 await run("UPDATE record SET ciphertext=? WHERE id IN ('limit-0','limit-1','limit-2','limit-3')",cipher(4));
 const over=await signed({...request([record('over-limit')]),generation:2});await assert.rejects(pushD1(db,principal,over));
 assert.equal((await one('SELECT count(*) n FROM record WHERE user_id=?','owner')).n,1000);
 assert.ok(await one('SELECT id FROM security_challenge WHERE id=?',over.proof.id));
 // Oversized legacy datasets fail closed without loading all ciphertext.
 await run("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<9000) INSERT INTO record(id,user_id,type,ciphertext,iv,updated_at_ms,version,seq) SELECT 'legacy-'||x,'owner','case',?,?,?,1,10000+x FROM n",cipher(4),iv,now);
 ciphertextRows=0;
 await assert.rejects(pushD1(measured,principal,deltaRequest(0)),e=>e.code==='PAYLOAD_TOO_LARGE');
 assert.equal(ciphertextRows,0);assert.equal((await one('SELECT count(*) n FROM record WHERE user_id=?','owner')).n,10000);
 assert.equal((await one('SELECT count(*) n FROM cockpit_atomic_assertion')).n,0);
 console.log('PASS D1 signed sync: insert, ciphertext preservation, unsigned/tamper/replay refusal, CAS race, encrypted revision, conflict, audit failure rollback, tenant isolation, commit-time revocation, generation; rekey ticket reuse, atomic key envelope, rollback and concurrent edit refusal; bounded pages/bytes, zero-copy idle, one-row update, cursor continuity, read snapshot CAS, legacy ties and oversized account guard');
 }finally{await mf.dispose()}
})().catch(e=>{console.error(e);process.exitCode=1});
