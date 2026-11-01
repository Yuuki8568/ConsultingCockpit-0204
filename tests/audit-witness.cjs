const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createRequire}=require('node:module');
const dep=createRequire(require.resolve('wrangler'));
const {build}=dep('esbuild');
const {Miniflare,convertV4MiniflareOptions}=dep('miniflare');
(async()=>{
 const built=await build({entryPoints:['cloudflare/audit-witness/worker.ts'],bundle:true,format:'esm',write:false});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-17',d1Databases:['DB']}));
 try{
  const db=await mf.getD1Database('DB');await db.exec(readFileSync('cloudflare/audit-witness/schema.sql','utf8'));
  const send=(body)=>mf.dispatchFetch('https://witness/checkpoint',{method:'POST',body:JSON.stringify(body)});
  const one={userId:'synthetic',seq:1,hash:'a'.repeat(64),previousSeq:0,previousHash:'GENESIS'};
  assert.equal((await send(one)).status,200);assert.equal((await send(one)).status,200);
  assert.equal((await send({...one,hash:'b'.repeat(64)})).status,409);
  assert.equal((await send({...one,seq:2,hash:'b'.repeat(64)})).status,409);
  assert.equal((await send({...one,seq:2,hash:'b'.repeat(64),previousSeq:1,previousHash:one.hash})).status,200);
  assert.equal((await mf.dispatchFetch('https://witness/checkpoint',{method:'DELETE'})).status,405);
  assert.equal((await mf.dispatchFetch('https://witness/checkpoint',{method:'POST',body:'x'.repeat(2049)})).status,413);
  assert.deepEqual(await (await mf.dispatchFetch('https://witness/head?user=synthetic')).json(),{seq:2,hash:'b'.repeat(64)});
  console.log('PASS: isolated D1 witness append, duplicate retry, overwrite refusal, stale-head refusal, no delete route, body cap');
 }finally{await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
