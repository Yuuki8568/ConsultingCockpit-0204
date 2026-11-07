const assert=require('node:assert/strict'),fs=require('node:fs');
const dep=require('node:module').createRequire(require.resolve('wrangler'));
const web=require('node:module').createRequire(require('node:path').resolve('packages/web/package.json'));
const {build}=dep('esbuild'),{Miniflare,convertV4MiniflareOptions}=dep('miniflare'),{chromium}=web('@playwright/test');
(async()=>{
 Object.assign(process.env,{NODE_ENV:'production',WEBSITE_URL:'https://cockpit.example.invalid',OWNER_EMAILS:'owner@example.invalid',BETTER_AUTH_SECRET:'isolated-http-test-secret-not-for-production-000000000000',GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic'});process.env.COCKPIT_APPROVED_PASSKEYS='[]';
 const b=await build({stdin:{contents:`export {auditHash} from './packages/web/src/api/security/audit.ts';export {publishWitnessesD1} from './packages/web/src/api/database/d1/witness.ts';export {createD1Api} from './packages/web/src/api/database/d1/http.ts';export {mutateDeviceD1} from './packages/web/src/api/database/d1/devices.ts';export {registerWriteKeyD1,writeChallengeD1} from './packages/web/src/api/database/d1/write-keys.ts';export {pushD1} from './packages/web/src/api/database/d1/sync.ts';export {operationHash,signingMessage} from './packages/web/src/shared/operation-proof.ts'`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'packages/web/tests/.d1-http-test.mjs'});
 const {auditHash,publishWitnessesD1,createD1Api,mutateDeviceD1,operationHash,signingMessage,registerWriteKeyD1,writeChallengeD1,pushD1}=await import(require('node:url').pathToFileURL(require('node:path').resolve('packages/web/tests/.d1-http-test.mjs')));
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-10-17',d1Databases:['DB']}));
 let browser;
 try{
 const db=await mf.getD1Database('DB');
 await db.batch((fs.readFileSync('cloudflare/d1/business-schema.sql','utf8')+fs.readFileSync('cloudflare/d1/schema.sql','utf8')).replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 const run=(sql,...args)=>db.prepare(sql).bind(...args).run(),one=(sql,...args)=>db.prepare(sql).bind(...args).first();
 const now=Date.now(),ctx={user:{id:'owner',email:'owner@example.invalid'},session:{id:'session'}},p={userId:'owner',sessionId:'session'};
 await run('INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)','owner','test',ctx.user.email,now,now);
 await run('INSERT INTO session(id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)','session',now+3600000,'synthetic',now,now,'owner');
 let anchor={seq:0,hash:'GENESIS'};
 const witness={async fetch(request){if(request.method==='GET')return Response.json(anchor);const value=await request.json();anchor={seq:value.seq,hash:value.hash};return Response.json({ok:true});}};
 const app=createD1Api(db,witness);
 const signatureCookie=require('node:crypto').createHmac('sha256',process.env.BETTER_AUTH_SECRET).update('synthetic').digest('base64');
 const cookie='__Secure-better-auth.session_token='+encodeURIComponent('synthetic.'+signatureCookie);
 const headers={origin:process.env.WEBSITE_URL,cookie,'content-type':'application/json'};
 async function rpc(path,input){const r=await app.request('/api/rpc/'+path,{method:'POST',headers,body:JSON.stringify({json:input??null})});if(!r.ok)throw Error('RPC '+path+' '+r.status);return (await r.json()).json;}
 const keys=Object.fromEntries(['list','registrationOptions','register','authenticationOptions','authenticate'].map(name=>[name,input=>rpc('passkeys/'+name,input)]));
 assert.equal((await app.request('/api/rpc/vault/status',{method:'POST',headers:{'content-type':'application/json'},body:'{"json":null}'})).status,401);
 assert.equal((await app.request('/api/rpc/vault/status',{method:'POST',headers:{...headers,origin:'https://evil.invalid'},body:'{"json":null}'})).status,403);
 assert.equal((await rpc('vault/status')).exists,false);
 assert.equal((await rpc('vault/status')).storageBackend,'d1');
 assert.equal((await app.request('/api/rpc/devices/register',{method:'POST',headers,body:'{"json":{"id":"x"}}'})).status,400);
 const maintenance=createD1Api(db,undefined,true);
 assert.equal((await maintenance.request('/api/rpc/vault/eraseAll',{method:'POST',headers,body:'{"json":{"confirm":"ERASE"}}'})).status,503);

 browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage();
 await page.route('https://cockpit.example.invalid/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<title>Synthetic D1 WebAuthn test</title>'}));
 await page.goto(process.env.WEBSITE_URL);
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
 await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 async function response(options,register){return page.evaluate(async({options,register})=>{
 const bytes=v=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
 const b64=v=>btoa(String.fromCharCode(...new Uint8Array(v))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 options.challenge=bytes(options.challenge);
 if(register){options.user.id=bytes(options.user.id);options.excludeCredentials=options.excludeCredentials.map(c=>({...c,id:bytes(c.id)}));}
 else options.allowCredentials=options.allowCredentials.map(c=>({...c,id:bytes(c.id)}));
 const c=await navigator.credentials[register?'create':'get']({publicKey:options});
 return {id:c.id,rawId:b64(c.rawId),type:c.type,authenticatorAttachment:c.authenticatorAttachment,clientExtensionResults:c.getClientExtensionResults(),response:register?{clientDataJSON:b64(c.response.clientDataJSON),attestationObject:b64(c.response.attestationObject),transports:c.response.getTransports()}:{clientDataJSON:b64(c.response.clientDataJSON),authenticatorData:b64(c.response.authenticatorData),signature:b64(c.response.signature),userHandle:c.response.userHandle?b64(c.response.userHandle):null}};
 },{options,register});}
 const challenge=await keys.registrationOptions(),r=await response(challenge.options,true);
 const registered=await keys.register({id:challenge.id,response:r});assert.equal(registered.approved,false);
 await assert.rejects(keys.register({id:challenge.id,response:r}));
 const input={id:'android-device',label:'Android',platform:'Android'},action='device:register',payloadHash=await operationHash(input);
 await assert.rejects(keys.authenticationOptions({action,payloadHash}));
 // Test-only out-of-band approval, never an application endpoint.
 process.env.COCKPIT_APPROVED_PASSKEYS=JSON.stringify([registered.fingerprint]);
 assert.equal((await keys.list())[0].approved,true);
 async function assertion(){const c=await keys.authenticationOptions({action,payloadHash});return {id:c.id,response:await response(c.options,false)}}
 const a=await assertion(),ticket=await keys.authenticate(a);
 await assert.rejects(keys.authenticate(a));
 await assert.rejects(mutateDeviceD1(db,p,action,{...input,label:'tampered',authorization:ticket.id}));
 await rpc('devices/register',{...input,authorization:ticket.id});
 assert.equal(await one('SELECT id FROM step_up_ticket WHERE id=?',ticket.id),null);
 const bad=await assertion();bad.response.response.signature=Buffer.alloc(64).toString('base64url');await assert.rejects(keys.authenticate(bad));
 const before=await one('SELECT counter FROM passkey_credential');
 const rollback=await assertion();await db.exec("CREATE TRIGGER reject_ticket BEFORE INSERT ON step_up_ticket BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 await assert.rejects(keys.authenticate(rollback));assert.equal((await one('SELECT counter FROM passkey_credential')).counter,before.counter);
 await db.exec('DROP TRIGGER reject_ticket');
 // Complete passkey -> write-key registration -> signed D1 synchronization path.
 const cipher=Buffer.alloc(32,3).toString('base64'),iv=Buffer.alloc(12,2).toString('base64');
 await run('INSERT INTO vault(user_id,kdf_salt,verifier_ciphertext,verifier_iv,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?)','owner',cipher,cipher,iv,now,now);
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const keyInput={publicKey:{kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y},privateCiphertext:cipher,privateIv:iv,generation:1,expectedVersion:0};
 await assert.rejects(registerWriteKeyD1(db,p,keyInput));
 const keyOptions=await keys.authenticationOptions({action:'write-key:register',payloadHash:await operationHash(keyInput)});
 const keyTicket=await keys.authenticate({id:keyOptions.id,response:await response(keyOptions.options,false)});
 await rpc('writeKeys/register',{...keyInput,authorization:keyTicket.id});
 await assert.rejects(registerWriteKeyD1(db,p,{...keyInput,authorization:keyTicket.id}));
 const push={deviceId:input.id,generation:1,since:0,records:[{operation:'put',id:'case-one',type:'case',ciphertext:cipher,iv,updatedAtMs:now,deleted:false,baseSeq:0}]};
 const write=await rpc('writeKeys/challenge',{deviceId:input.id,payloadHash:await operationHash(push)});
 const signature=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(signingMessage(write)))).toString('base64');
 const signed={...push,proof:{id:write.id,signature}};
 assert.deepEqual((await rpc('sync/push',signed)).accepted,['case-one']);
 await assert.rejects(pushD1(db,{...p,deviceId:input.id},signed));
 assert.equal((await rpc('sync/pullAll',{deviceId:input.id,after:0})).records[0].ciphertext,cipher);
 assert.equal((await rpc('sync/stats')).byType.case,1);
 assert.equal((await rpc('devices/list'))[0].id,input.id);
 await rpc('devices/logLogin',{kind:'unlock_ok',deviceId:'forged-device'});
 assert.equal((await rpc('devices/loginHistory',{limit:10}))[0].deviceId,input.id);
 await rpc('vault/unlockParams');
 await rpc('devices/clearLoginHistory');
 assert.equal((await rpc('devices/loginHistory',{limit:10})).length,0);
 assert.equal((await one('SELECT count FROM security_counter WHERE key=?','unlock:owner')).count,1);
 const entry=await rpc('audit/append',{action:'test',atMs:0,deviceId:'forged-device',payloadCiphertext:cipher,payloadIv:iv});
 const events=await rpc('audit/list',{limit:10,offset:0});assert.equal(events[0].seq,entry.seq);assert.equal(events[0].deviceId,input.id);assert.ok(events[0].atMs>now-1000);
 assert.equal((await rpc('audit/count')).count,events.length);
 assert.equal((await rpc('audit/verifyChain')).ok,false);
 await publishWitnessesD1(db,witness);assert.equal((await rpc('audit/verifyChain')).ok,true);
 await run("UPDATE audit_event SET payload_iv='tampered' WHERE seq=?",entry.seq);assert.equal((await rpc('audit/verifyChain')).ok,false);
 await run('UPDATE audit_event SET payload_iv=? WHERE seq=?',iv,entry.seq);
 // Exercise more than 100 authenticated page requests, not just the verifier
 // in isolation. This catches session/rate-limit/HTTP adapter regressions.
 const prior=await one("SELECT seq,hash FROM audit_head WHERE user_id='owner'");
 let lastSeq=prior.seq,lastHash=prior.hash,pending=[];
 for(let n=prior.seq+1;n<=10025;n++){
   const row={id:'paged-'+n,userId:'owner',seq:n,action:'synthetic-page',atMs:now,
     deviceId:null,payloadCiphertext:null,payloadIv:null,prevHash:lastHash,hashVersion:2};
   const h=await auditHash(row);
   pending.push(db.prepare('INSERT INTO audit_event(id,user_id,seq,action,at_ms,prev_hash,hash,hash_version) VALUES (?,?,?,?,?,?,?,2)')
     .bind(row.id,'owner',n,row.action,now,lastHash,h));
   lastSeq=n;lastHash=h;
   if(pending.length===100){await db.batch(pending);pending=[];}
 }
 if(pending.length)await db.batch(pending);
 await run("UPDATE audit_head SET seq=?,hash=? WHERE user_id='owner'",lastSeq,lastHash);
 anchor={seq:lastSeq,hash:lastHash}; // Synthetic independent service fixture only.
 let auditCursor,auditPages=0,auditResult;
 do{
   auditResult=await rpc('audit/verifyChain',auditCursor?{cursor:auditCursor}:undefined);auditPages++;
   if(!auditResult.complete){assert.equal(auditResult.ok,false);assert.ok(auditResult.cursor);}
   if(auditPages===1){
     const forged=await rpc('audit/verifyChain',{cursor:auditResult.cursor+'invalid'});
     assert.equal(forged.ok,false);assert.equal(forged.cursor,undefined);
   }
   auditCursor=auditResult.cursor;
 }while(auditCursor&&auditPages<110);
 assert.equal(auditResult.ok,true);assert.equal(auditResult.checked,10025);assert.equal(auditPages,101);
 console.log('PASS D1 authenticated audit HTTP: 10,025 events, 101 pages, forged cursor rejected');
 await assert.rejects(rpc('audit/truncateOldest',{keepLatest:100}));await assert.rejects(rpc('sync/purgeDeleted',{olderThanDays:1}));
 const oversize=await app.request('/api/rpc/sync/push',{method:'POST',headers,body:JSON.stringify({json:'x'.repeat(4*1024*1024)})});assert.equal(oversize.status,413);
 const revoked=await assertion();await run('UPDATE device SET revoked_at_ms=? WHERE id=?',now,input.id);await assert.rejects(keys.authenticate(revoked));
 assert.equal((await one('SELECT count(*) n FROM step_up_ticket')).n,0);
 console.log('PASS D1 HTTP and virtual WebAuthn: registration, separate approval, assertion verification, scoped device registration ticket, replay/tamper refusal, counter rollback, revoked-session rejection');
 }finally{if(browser)await browser.close();await mf.dispose();fs.rmSync('packages/web/tests/.d1-http-test.mjs',{force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
