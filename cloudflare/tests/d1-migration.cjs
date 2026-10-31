const { createRequire } = require('node:module');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const wranglerRequire = createRequire(require.resolve('wrangler'));
const {Miniflare, convertV4MiniflareOptions} = wranglerRequire('miniflare');
const {transformSync} = wranglerRequire('esbuild');
const src = fs.readFileSync('packages/web/src/api/database/d1-migration.ts','utf8');
const mod = {exports:{}};
new Function('module','exports',transformSync(src,{loader:'ts',format:'cjs'}).code)(mod,mod.exports);
const {stageEncryptedSnapshot,validateMigrationRows,MAX_ROWS} = mod.exports;
(async()=>{
 const mf = new Miniflare(convertV4MiniflareOptions({workers:[{name:'test',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-17',d1Databases:['DB']}]}));
 try {
  const db = await mf.getD1Database('DB');
  for(const sql of fs.readFileSync('cloudflare/d1/0001-encrypted-migration.sql','utf8').split(';').filter(s=>s.trim())) await db.prepare(sql).run();
  const rows=[{table:'vault',payload:'{"kdfSalt":"synthetic"}'},{table:'record',payload:'{"ciphertext":"synthetic","iv":"synthetic"}'}];
  const result=await stageEncryptedSnapshot(db,'test-owner',rows);
  assert.equal(result.verified,true);assert.equal(result.backendChanged,false);
  const run=await db.prepare('SELECT * FROM cockpit_migration_run WHERE id=?').bind(result.id).first();
  assert.equal(run.status,'verified');assert.equal(run.row_count,2);
  await assert.rejects(()=>stageEncryptedSnapshot(db,'test-owner',rows));
  const other=await stageEncryptedSnapshot(db,'other-owner',rows);
  assert.notEqual(other.id,result.id);
  const wrong=await db.prepare('SELECT * FROM cockpit_migration_run WHERE id=? AND user_id=?').bind(result.id,'other-owner').first();
  assert.equal(wrong,null);
  assert.throws(()=>validateMigrationRows([{table:'session',payload:'secret'}]));
  assert.throws(()=>validateMigrationRows(Array(MAX_ROWS+1).fill(rows[0])));
  assert.throws(()=>validateMigrationRows([{table:'record',payload:'x'.repeat(1600*1024)}]));
  // Actual database write failure must never produce a verified run.
  await db.prepare('DROP TABLE cockpit_migration_row').run();
  await assert.rejects(()=>stageEncryptedSnapshot(db,'failed-owner',rows));
  const failed=await db.prepare('SELECT status FROM cockpit_migration_run WHERE user_id=?').bind('failed-owner').first();
  assert.equal(failed.status,'failed');
  console.log('D1 integration checks passed: copy/readback, throttling, owner separation, limits, failure status.');
 } finally {await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
