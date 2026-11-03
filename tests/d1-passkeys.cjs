const assert=require('node:assert/strict'),fs=require('node:fs');
const dep=require('node:module').createRequire(require.resolve('wrangler'));
const web=require('node:module').createRequire(require('node:path').resolve('packages/web/package.json'));
const {build}=dep('esbuild'),{Miniflare,convertV4MiniflareOptions}=dep('miniflare'),{chromium}=web('@playwright/test');
(async()=>{
 process.env.WEBSITE_URL='https://cockpit.example.invalid';process.env.COCKPIT_APPROVED_PASSKEYS='[]';
 const b=await build({stdin:{contents:`export {createD1Passkeys} from './packages/web/src/api/database/d1/passkeys.ts';export {mutateDeviceD1} from './packages/web/src/api/database/d1/devices.ts';export {registerWriteKeyD1,writeChallengeD1} from './packages/web/src/api/database/d1/write-keys.ts';export {pushD1} from './packages/web/src/api/database/d1/sync.ts';export {operationHash,signingMessage} from './packages/web/src/shared/operation-proof.ts'`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
 const {createD1Passkeys,mutateDeviceD1,operationHash,signingMessage,registerWriteKeyD1,writeChallengeD1,pushD1}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-10-17',d1Databases:['DB']}));
 let browser;
 try{
 const db=await mf.getD1Database('DB');
 await db.batch((fs.readFileSync('cloudflare/d1/business-schema.sql','utf8')+fs.readFileSync('cloudflare/d1/schema.sql','utf8')).replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 const run=(sql,...args)=>db.prepare(sql).bind(...args).run(),one=(sql,...args)=>db.prepare(sql).bind(...args).first();
 const now=Date.now(),ctx={user:{id:'owner',email:'owner@example.invalid'},session:{id:'session'}},p={userId:'owner',sessionId:'session'};
 await run('INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)','owner','test',ctx.user.email,now,now);
 await run('INSERT INTO session(id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)','session',now+3600000,'synthetic',now,now,'owner');
 const keys=createD1Passkeys(db,ctx);
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
 await mutateDeviceD1(db,p,action,{...input,authorization:ticket.id});
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
 await registerWriteKeyD1(db,p,{...keyInput,authorization:keyTicket.id});
 await assert.rejects(registerWriteKeyD1(db,p,{...keyInput,authorization:keyTicket.id}));
 const push={deviceId:input.id,generation:1,since:0,records:[{operation:'put',id:'case-one',type:'case',ciphertext:cipher,iv,updatedAtMs:now,deleted:false,baseSeq:0}]};
 const write=await writeChallengeD1(db,p,{deviceId:input.id,payloadHash:await operationHash(push)});
 const signature=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(signingMessage(write)))).toString('base64');
 const signed={...push,proof:{id:write.id,signature}};
 assert.deepEqual((await pushD1(db,{...p,deviceId:input.id},signed)).accepted,['case-one']);
 await assert.rejects(pushD1(db,{...p,deviceId:input.id},signed));
 const revoked=await assertion();await run('UPDATE device SET revoked_at_ms=? WHERE id=?',now,input.id);await assert.rejects(keys.authenticate(revoked));
 assert.equal((await one('SELECT count(*) n FROM step_up_ticket')).n,0);
 console.log('PASS D1 virtual WebAuthn: registration, separate approval, assertion verification, scoped device registration ticket, replay/tamper refusal, counter rollback, revoked-session rejection');
 }finally{if(browser)await browser.close();await mf.dispose()}
})().catch(e=>{console.error(e);process.exitCode=1});
