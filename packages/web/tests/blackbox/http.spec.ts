import { test, expect } from '@playwright/test';
const rpc = (request: any, path: string, input?: unknown, token='dummy-owner-token') => request.post(`/api/rpc/${path}`, {
  headers: token ? {Authorization:`Bearer ${token}`} : {}, data:{json:input ?? null}
});
test('unauthenticated and forged sessions cannot read vault material', async ({request}) => {
  for (const token of ['', 'forged-token']) for (const path of ['vault/status','vault/unlockParams','devices/list','audit/count']) {
    const res = await rpc(request,path,undefined,token); expect(res.status()).toBe(401);
  }
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
  const allowed = await request.fetch('/api/rpc/vault/status',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:4420'}});
  expect(allowed.status()).toBe(204); expect(allowed.headers()['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
});
test('HTTP response hardening and nonexistent secret paths', async ({request}) => {
  const res = await request.get('/'); expect(res.status()).toBe(200);
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(res.headers()['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
  expect(res.headers()['x-frame-options']).toBe('DENY'); expect(res.headers()['cache-control']).toBe('no-store');
  for (const path of ['/.env','/.git/config','/assets/missing.js.map']) expect((await request.get(path)).status()).toBe(404);
});
test('server generation, stale revision, rekey completeness and idempotence', async ({request}) => {
  const create = await rpc(request,'vault/create',{kdfSalt:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',kdfIterations:100000,verifierCiphertext:'dummy-verifier',verifierIv:'dummy-iv'});
  expect(create.status()).toBe(200);
  const rec = {id:'case:dummy',type:'case',ciphertext:'ciphertext-one',iv:'iv',updatedAtMs:1,deleted:false,baseSeq:0};
  const push = await rpc(request,'sync/push',{deviceId:'test-device',generation:1,since:0,records:[rec]});
  expect(push.status()).toBe(200); const first = (await push.json()).json;
  const seq = first.changed[0].seq;
  const stale = await rpc(request,'sync/push',{deviceId:'test-device',generation:1,since:0,records:[{...rec,ciphertext:'stale',updatedAtMs:9999999999999}]});
  expect(stale.status()).toBe(200); expect((await stale.json()).json.conflicts).toHaveLength(1);
  const rekey = {expectedGeneration:1,kdfSalt:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',kdfIterations:100000,verifierCiphertext:'new-verifier',verifierIv:'new-iv',records:[{id:rec.id,ciphertext:'new-cipher',iv:'new-iv',baseSeq:seq}]};
  expect((await rpc(request,'vault/rekey',{...rekey,records:[]})).status()).toBe(409);
  expect((await rpc(request,'vault/rekey',rekey)).status()).toBe(200);
  expect((await rpc(request,'vault/rekey',rekey)).status()).toBe(200);
  expect((await rpc(request,'sync/push',{deviceId:'test-device',generation:1,since:0,records:[rec]})).status()).toBe(409);
  expect((await rpc(request,'sync/push',{deviceId:'unknown-device',generation:2,since:0,records:[]})).status()).toBe(403);
});
test('browser blocks cross-origin framing', async ({page}) => {
  const errors: string[] = []; page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:4420/');
  await page.setContent('<iframe src="http://localhost:4420/"></iframe>');
  await expect.poll(() => errors.some(t => /frame-ancestors|X-Frame-Options|refused.*frame/i.test(t))).toBe(true);
  expect(page.frames().some(f => f.url()==='http://localhost:4420/')).toBe(false);
});
test('unlock material is rate limited on server', async ({request}) => {
  for (let i=0;i<20;i++) expect((await rpc(request,'vault/unlockParams')).status()).toBe(200);
  expect((await rpc(request,'vault/unlockParams')).status()).toBe(429);
});
test('sign-out revokes a previously valid bearer session', async ({request}) => {
  expect((await rpc(request,'vault/status')).status()).toBe(200);
  const response = await request.post('/api/auth/sign-out',{headers:{Authorization:'Bearer dummy-owner-token',Origin:'http://127.0.0.1:4420'},data:{}});
  expect(response.status()).toBe(200);
  expect((await rpc(request,'vault/status')).status()).toBe(401);
});
