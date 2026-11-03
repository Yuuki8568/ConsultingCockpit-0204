const assert=require('node:assert/strict'),fs=require('node:fs');
const dep=require('node:module').createRequire(require.resolve('wrangler'));
const {build}=dep('esbuild'),{Miniflare,convertV4MiniflareOptions}=dep('miniflare');
(async()=>{
 const bundled=await build({stdin:{contents:`export {atomicCheckedBatch} from './cloudflare/d1/atomic-batch.ts'`,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',write:false});
 const {atomicCheckedBatch}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-10-17',d1Databases:['DB']}));
 try{
  const db=await mf.getD1Database('DB');
  await db.exec(fs.readFileSync('cloudflare/d1/schema.sql','utf8').replace(/--[^\n]*/g,'').replace(/\n/g,' '));
  await db.exec('CREATE TABLE record(id TEXT PRIMARY KEY, version INTEGER, ciphertext TEXT); CREATE TABLE revision(id INTEGER PRIMARY KEY, ciphertext TEXT); CREATE TABLE audit(id INTEGER PRIMARY KEY, action TEXT);');
  await db.prepare('INSERT INTO record VALUES (?,?,?)').bind('synthetic',1,'encrypted-old').run();
  const plan=(version,cipher)=>[
   {statement:db.prepare('INSERT INTO revision(ciphertext) SELECT ciphertext FROM record WHERE id=?').bind('synthetic'),expectedChanges:1},
   {statement:db.prepare('UPDATE record SET version=version+1,ciphertext=? WHERE id=? AND version=?').bind(cipher,'synthetic',version),expectedChanges:1},
   {statement:db.prepare('INSERT INTO audit(action) VALUES (?)').bind('update'),expectedChanges:1}
  ];
  await assert.rejects(atomicCheckedBatch(db,plan(0,'invalid')));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM revision').first()).n,0);
  assert.equal((await db.prepare('SELECT ciphertext FROM record').first()).ciphertext,'encrypted-old');
  const raced=await Promise.allSettled([atomicCheckedBatch(db,plan(1,'encrypted-a')),atomicCheckedBatch(db,plan(1,'encrypted-b'))]);
  assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM revision').first()).n,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM audit').first()).n,1);
  assert.equal((await db.prepare('SELECT version FROM record').first()).version,2);
  // A late constraint failure must also undo the accepted version update.
  await assert.rejects(atomicCheckedBatch(db,[...plan(2,'must-rollback'),{statement:db.prepare('INSERT INTO audit(id,action) VALUES (1,?)').bind('duplicate'),expectedChanges:1}]));
  assert.equal((await db.prepare('SELECT version FROM record').first()).version,2);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM revision').first()).n,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM cockpit_atomic_assertion').first()).n,0);
  console.log('PASS D1 atomic CAS: concurrent winner, complete rollback, no orphan archive/audit/assertions');
 }finally{await mf.dispose()}
})().catch(e=>{console.error(e);process.exitCode=1});
