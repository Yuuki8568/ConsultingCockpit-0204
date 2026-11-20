import {operationHash,signingMessage} from "../../src/shared/operation-proof";
import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
const cookie = (token: string) => {
 const signature = createHmac('sha256','isolated-test-secret-not-for-production-000000000000').update(token).digest('base64');
 return `__Secure-better-auth.session_token=${encodeURIComponent(token + '.' + signature)}`;
};
const rpc = (request: any, path: string, input?: unknown, token='dummy-owner-token') => request.post(`/api/rpc/${path}`, {
  headers: token ? {Cookie:cookie(token)} : {}, data:{json:input ?? null}
});
test('unauthenticated and forged sessions cannot read vault material', async ({request}) => {
  for (const token of ['', 'forged-token']) for (const path of ['vault/status','vault/unlockParams','devices/list','audit/count']) {
    const res = await rpc(request,path,undefined,token); expect(res.status()).toBe(401);
  }
});
test('legacy bearer credentials are not accepted on the independent host', async ({request}) => {
 const res = await request.post('/api/rpc/vault/status', {headers:{Authorization:'Bearer dummy-owner-token'},data:{json:null}});
 expect(res.status()).toBe(401);
});
test('authenticated non-owner is forbidden', async ({request}) => {
  expect((await rpc(request,'vault/status',undefined,'dummy-outsider-token')).status()).toBe(403);
});
test('CORS rejects foreign/null origins including preflight without reflecting credentials', async ({request}) => {
  for (const origin of ['https://attacker.invalid','null','file://anything','runable-consult-rjau47t://evil']) {
    for (const method of ['OPTIONS','POST']) {
      const res = await request.fetch('/api/rpc/vault/status',{method,headers:{Origin:origin},data:{json:null}});
      expect(res.status()).toBe(403); expect(res.headers()['access-control-allow-origin']).toBeUndefined();
    }
  }
  const allowed = await request.fetch('/api/rpc/vault/status',{method:'OPTIONS',headers:{Origin:'http://localhost:4420'}});
  expect(allowed.status()).toBe(204); expect(allowed.headers()['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
});
test('HTTP response hardening and nonexistent secret paths', async ({request}) => {
  const res = await request.get('/'); expect(res.status()).toBe(200);
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(res.headers()['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
  expect(res.headers()['x-frame-options']).toBe('DENY'); expect(res.headers()['cache-control']).toBe('no-store');
  for (const path of ['/.env','/.git/config','/assets/missing.js.map']) expect((await request.get(path)).status()).toBe(404);
});
test('session alone cannot write ciphertext or perform protected operations', async ({request}) => {
  const rec={id:'case:dummy',type:'case',operation:'put',ciphertext:Buffer.alloc(32,1).toString('base64'),iv:Buffer.alloc(12,2).toString('base64'),updatedAtMs:1,deleted:false,baseSeq:0};
  expect((await rpc(request,'sync/push',{deviceId:'test-device',generation:1,since:0,records:[rec]})).status()).toBe(401);
  expect((await rpc(request,'sync/push',{deviceId:'unknown-device',generation:1,since:0,records:[]})).status()).toBe(403);
  expect((await rpc(request,'sync/push',{deviceId:'test-device',generation:1,since:0,records:[]})).status()).toBe(200);
  for(const path of ['devices/revoke','devices/unrevoke','devices/remove']) expect((await rpc(request,path,{id:'test-device'})).status()).toBe(401);
  expect((await rpc(request,'vault/eraseAll',{confirm:'ERASE'})).status()).toBe(401);
  expect((await rpc(request,'vault/rekey',{expectedGeneration:1,kdfSalt:Buffer.alloc(32,4).toString('base64'),kdfIterations:600000,verifierCiphertext:rec.ciphertext,verifierIv:rec.iv,records:[]})).status()).toBe(401);
  expect((await rpc(request,'sync/purgeDeleted',{olderThanDays:1})).status()).toBe(403);
  expect((await rpc(request,'passkeys/authenticationOptions',{action:'vault:erase',payloadHash:'a'.repeat(64)})).status()).toBe(403);
});
test('virtual passkey registration, out-of-band approval, signed write and replay rejection', async ({page,request,context})=>{
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
 await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 await page.goto('/');
 const challenge=(await (await rpc(request,'passkeys/registrationOptions')).json()).json;
 const response=await page.evaluate(async(options:any)=>{
  const bytes=(v:string)=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const b64=(v:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(v))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  options.challenge=bytes(options.challenge);options.user.id=bytes(options.user.id);options.excludeCredentials=options.excludeCredentials.map((c:any)=>({...c,id:bytes(c.id)}));
  const credential:any=await navigator.credentials.create({publicKey:options});
  return {id:credential.id,rawId:b64(credential.rawId),type:credential.type,authenticatorAttachment:credential.authenticatorAttachment,clientExtensionResults:credential.getClientExtensionResults(),response:{clientDataJSON:b64(credential.response.clientDataJSON),attestationObject:b64(credential.response.attestationObject),transports:credential.response.getTransports()}};
 },challenge.options);
 const registered=await rpc(request,'passkeys/register',{id:challenge.id,response});expect(registered.status()).toBe(200);
 const fingerprint=(await registered.json()).json.fingerprint;
 const authorize=async(action:string,payload:unknown)=>{
  const optionResponse=await rpc(request,'passkeys/authenticationOptions',{action,payloadHash:await operationHash(payload)});expect(optionResponse.status()).toBe(200);
  const challenge=(await optionResponse.json()).json;
  const response=await page.evaluate(async(options:any)=>{
   const bytes=(v:string)=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
   const b64=(v:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(v))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
   options.challenge=bytes(options.challenge);options.allowCredentials=options.allowCredentials.map((c:any)=>({...c,id:bytes(c.id)}));
   const credential:any=await navigator.credentials.get({publicKey:options});
   return {id:credential.id,rawId:b64(credential.rawId),type:credential.type,authenticatorAttachment:credential.authenticatorAttachment,clientExtensionResults:credential.getClientExtensionResults(),response:{clientDataJSON:b64(credential.response.clientDataJSON),authenticatorData:b64(credential.response.authenticatorData),signature:b64(credential.response.signature),userHandle:credential.response.userHandle?b64(credential.response.userHandle):null}};
  },challenge.options);
  const verified=await rpc(request,'passkeys/authenticate',{id:challenge.id,response});expect(verified.status()).toBe(200);return (await verified.json()).json.id;
 };
 expect((await rpc(request,'passkeys/authenticationOptions',{action:'write-key:register',payloadHash:'a'.repeat(64)})).status()).toBe(403);
 // Only this isolated fixture exposes operator approval; production has no approval API.
 expect((await request.post('/__test/approve',{data:{fingerprint}})).status()).toBe(200);
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const identity={publicKey:{kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y},privateCiphertext:Buffer.alloc(32,1).toString('base64'),privateIv:Buffer.alloc(12,2).toString('base64'),generation:1,expectedVersion:0};
 const authorization=await authorize('write-key:register',identity);
 expect((await rpc(request,'writeKeys/register',{...identity,authorization})).status()).toBe(200);
 expect((await rpc(request,'writeKeys/register',{...identity,authorization})).status()).toBe(401);
 const input={deviceId:'test-device',generation:1,since:0,records:[{id:'case:signed',type:'case',operation:'put',ciphertext:Buffer.alloc(32,3).toString('base64'),iv:Buffer.alloc(12,4).toString('base64'),updatedAtMs:1,deleted:false,baseSeq:0}]};
 const nonce=(await (await rpc(request,'writeKeys/challenge',{deviceId:'test-device',payloadHash:await operationHash(input)})).json()).json;
 const signature=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(signingMessage(nonce)))).toString('base64');
 const signed={...input,proof:{id:nonce.id,signature}};
 const saved=await rpc(request,'sync/push',signed);expect(saved.status()).toBe(200);
 const seq=(await saved.json()).json.acceptedVersions['case:signed'];
 expect((await rpc(request,'sync/push',signed)).status()).toBe(401);
 const rotation={expectedGeneration:1,kdfSalt:Buffer.alloc(32,5).toString('base64'),kdfIterations:600000,verifierCiphertext:identity.privateCiphertext,verifierIv:identity.privateIv,records:[{id:'case:signed',ciphertext:Buffer.alloc(32,6).toString('base64'),iv:identity.privateIv,baseSeq:seq}],writeKey:{privateCiphertext:identity.privateCiphertext,privateIv:identity.privateIv,expectedVersion:1}};
 const rotateTicket=await authorize('vault:rekey',rotation);
 expect((await rpc(request,'vault/rekey',{...rotation,authorization:rotateTicket})).status()).toBe(200);
 expect((await rpc(request,'vault/rekey',{...rotation,authorization:rotateTicket})).status()).toBe(401);
 expect((await rpc(request,'vault/rekey',{...rotation,authorization:await authorize('vault:rekey',rotation)})).status()).toBe(200);
 expect((await (await rpc(request,'writeKeys/current')).json()).json.generation).toBe(2);
 const remove={id:'other-device'};
 expect((await rpc(request,'devices/remove',{...remove,authorization:await authorize('device:remove',remove)})).status()).toBe(200);
 const devices=(await (await rpc(request,'devices/list')).json()).json;
 expect(devices.find((d:any)=>d.id==='other-device').revokedAtMs).toBeGreaterThan(0);
 expect((await rpc(request,'vault/status',undefined,'dummy-other-token')).status()).toBe(401);
 expect((await rpc(request,'devices/register',{id:'other-device',label:'retry',platform:'test'})).status()).toBe(403);
 expect((await rpc(request,'devices/unrevoke',{...remove,authorization:await authorize('device:unrevoke',remove)})).status()).toBe(200);
 expect((await rpc(request,'vault/status',undefined,'dummy-other-token')).status()).toBe(401);

});
test('browser blocks cross-origin framing', async ({page}) => {
  const errors: string[] = []; page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  await page.goto('http://localhost:4420/');
  await page.setContent('<iframe src="http://127.0.0.1:4420/"></iframe>');
  await expect.poll(() => errors.some(t => /frame-ancestors|X-Frame-Options|refused.*frame/i.test(t))).toBe(true);
  expect(page.frames().some(f => f.url()==='http://127.0.0.1:4420/')).toBe(false);
});
test('unlock material is rate limited on server', async ({request}) => {
  for (let i=0;i<20;i++) expect((await rpc(request,'vault/unlockParams')).status()).toBe(200);
  expect((await rpc(request,'vault/unlockParams')).status()).toBe(429);
  expect((await rpc(request,'devices/clearLoginHistory')).status()).toBe(200);
  expect((await rpc(request,'vault/unlockParams')).status()).toBe(429);
});
test('sign-out revokes a previously valid signed cookie session', async ({request}) => {
  expect((await rpc(request,'vault/status')).status()).toBe(200);
  const response = await request.post('/api/auth/sign-out',{headers:{Cookie:cookie('dummy-owner-token'),Origin:'http://localhost:4420'},data:{}});
  expect(response.status()).toBe(200);
  expect((await rpc(request,'vault/status')).status()).toBe(401);
});
