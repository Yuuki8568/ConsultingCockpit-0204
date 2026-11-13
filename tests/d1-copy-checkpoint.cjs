// Synthetic local libSQL and Miniflare only; no production credentials or data.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const dep = require('node:module').createRequire(require.resolve('wrangler'));
const { build } = dep('esbuild'), { Miniflare, convertV4MiniflareOptions } = dep('miniflare');
const { createClient } = require('@libsql/client');
module.exports = async function runCopyCheckpointTests() {
  const output = 'packages/web/tests/.d1-copy-checkpoint-test.mjs';
  await build({ stdin: { contents: `export * from './security-ops/d1-copy-checkpoint.ts'; export {migrationDefinitions} from './packages/web/src/api/database/d1/migration-schema.ts'`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: output });
  const { initializeBoundedCopy: start, getBoundedCopyStatus: status, copyBoundedStep: step, COPY_CHECKPOINT_SCHEMA, migrationDefinitions: defs } = await import(require('node:url').pathToFileURL(path.resolve(output)));
  const temporary = fs.mkdtempSync('/tmp/cockpit-copy-checkpoint-');
  const source = createClient({ url: 'file:' + temporary + '/source.sqlite' });
  const opts = { modules: true, script: 'export default {fetch(){return new Response("synthetic")}}', compatibilityDate: '2026-10-17', d1Databases: ['RUN', 'RACE', 'UNKNOWN', 'ROLLBACK', 'GUARD'], resourcePersistencePath: temporary + '/d1' };
  let mf = new Miniflare(convertV4MiniflareOptions(opts));
  const scope = { maintenanceConfirmed: true, destinationDetached: true, sourceIdentitySha256: 'a'.repeat(64), ownerEmails: ['owner@example.invalid'] };
  const runId = '00000000-0000-4000-8000-000000000001';
  const quote = c => '"' + c.replaceAll('"', '""') + '"';
  const readonlySource = { async transaction(mode) {
    assert.equal(mode, 'read'); const tx = await source.transaction(mode);
    return new Proxy(tx, { get(t, k) {
      if (k === 'execute') return st => { assert.match(st.sql, /^SELECT /); return t.execute(st); };
      const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
    }});
  }};
  // Wrap only the mutation batch (metadata reads have a single statement).
  const intercept = (db, fn) => new Proxy(db, { get(t, k) {
    if (k === 'withSession') return option => {
      assert.equal(option, 'first-primary'); const s = t.withSession(option);
      return new Proxy(s, { get(u, key) {
        if (key === 'batch') return stmts => stmts.length > 1 ? fn(u, stmts) : u.batch(stmts);
        const v = u[key]; return typeof v === 'function' ? v.bind(u) : v;
      }});
    };
    const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
  }});
  try {
    const schema = fs.readFileSync('cloudflare/d1/business-schema.sql', 'utf8');
    await source.executeMultiple(schema);
    for (const def of defs) {
      const info = (await source.execute(`PRAGMA table_info(${quote(def.name)})`)).rows;
      const values = def.columns.map(c => {
        if (c === 'user_id' || def.name === 'user' && c === 'id') return 'owner';
        if (c === 'email') return 'owner@example.invalid';
        if (c === 'email_verified') return 1;
        if (def.name === 'record' && c === 'ciphertext') return 'synthetic-\0-"-日本語-😀';
        const meta = info.find(r => r.name === c);
        if (!meta.notnull && !meta.pk) return null;
        return meta.type.toLowerCase() === 'integer' ? 1 : `synthetic-${def.name}-${c}`;
      });
      await source.execute({ sql: `INSERT INTO ${quote(def.name)} (${def.columns.map(quote).join(',')}) VALUES (${values.map(() => '?').join(',')})`, args: values });
    }
    await source.execute("INSERT INTO record(id,user_id,type,ciphertext,iv,updated_at_ms) VALUES ('z-last','owner','case','small','iv',0)");
    const ddl = (schema + fs.readFileSync('cloudflare/d1/schema.sql', 'utf8')).replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
    const dbs = {};
    for (const name of opts.d1Databases) {
      const db = dbs[name] = await mf.getD1Database(name);
      await db.batch(ddl.map(s => db.prepare(s)));
      await db.prepare(COPY_CHECKPOINT_SCHEMA).run();
    }
    await assert.rejects(start(dbs.RUN, runId, { ...scope, maintenanceConfirmed: false }), /^Error: COPY_SCOPE_REQUIRED$/);
    await assert.rejects(start(dbs.RUN, runId, { ...scope, destinationDetached: false }), /^Error: COPY_SCOPE_REQUIRED$/);
    await assert.rejects(start(dbs.RUN, 'not-a-run', scope), /^Error: COPY_INVALID_RUN$/);
    await assert.rejects(status(dbs.RUN, runId, scope), /^Error: COPY_NOT_STARTED$/);
    let cp = await start(dbs.RUN, runId, scope);
    assert.equal(cp.revision, 0); assert.equal(cp.cutoverAllowed, false); assert.equal(cp.verified, false);
    await assert.rejects(start(dbs.RUN, runId, scope), /^Error: COPY_INITIALIZE_UNCONFIRMED$/);
    await assert.rejects(step(readonlySource, dbs.RUN, runId, 0, { ...scope, sourceIdentitySha256: 'b'.repeat(64) }), /^Error: COPY_CONTEXT_MISMATCH$/);
    for (let i = 0; i < 5; i++) cp = await step(readonlySource, dbs.RUN, runId, cp.revision, scope);
    const persisted = cp;
    await mf.dispose(); // Restart the local Worker runtime and reopen persisted D1.
    mf = new Miniflare(convertV4MiniflareOptions(opts));
    for (const name of opts.d1Databases) dbs[name] = await mf.getD1Database(name);
    assert.deepEqual(await status(dbs.RUN, runId, scope), persisted);
    while (cp.phase !== 'copied') cp = await step(readonlySource, dbs.RUN, runId, cp.revision, scope);
    assert.equal(cp.rowsCopied, 19); assert.equal(cp.revision, 37); assert.equal(cp.verified, false); assert.equal(cp.cutoverAllowed, false);
    assert.deepEqual(await step({ transaction: () => { throw Error('must not read'); } }, dbs.RUN, runId, cp.revision, scope), cp);
    for (const def of defs) {
      // Compare exact bytes independently, including embedded NUL and Unicode.
      const sql = `SELECT ${def.columns.flatMap((c, i) => [`typeof(${quote(c)}) AS t${i}`, `hex(CAST(${quote(c)} AS BLOB)) AS h${i}`]).join(',')} FROM ${quote(def.name)} ORDER BY ${def.keys.map(quote).join(',')}`;
      const a = (await source.execute(sql)).rows.map(r => ({ ...r }));
      const b = (await dbs.RUN.prepare(sql).all()).results;
      assert.deepEqual(b, a, def.name);
    }
    assert.equal((await dbs.RUN.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='cockpit_cutover_receipt'").first()).n, 0);
    assert.equal((await dbs.RUN.prepare('SELECT count(*) n FROM cockpit_atomic_assertion').first()).n, 0);
    assert.ok(!JSON.stringify(cp).includes('owner@example.invalid'));

    // Two invocations reading the same checkpoint: one atomic winner only.
    await start(dbs.RACE, runId, scope);
    let arrived = 0, release; const gate = new Promise(resolve => release = resolve);
    const racingSource = { async transaction(mode) {
      if (++arrived === 2) release(); await gate; return readonlySource.transaction(mode);
    }};
    const race = await Promise.allSettled([step(racingSource, dbs.RACE, runId, 0, scope), step(racingSource, dbs.RACE, runId, 0, scope)]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await status(dbs.RACE, runId, scope)).revision, 1);
    assert.equal((await dbs.RACE.prepare('SELECT count(*) n FROM user').first()).n, 1);
    await assert.rejects(step(readonlySource, dbs.RACE, runId, 0, scope), /^Error: COPY_STALE_REVISION$/);

    // Commit succeeds but its response is lost. Re-read, then resume; no second row copy.
    await start(dbs.UNKNOWN, runId, scope);
    const lostResponse = intercept(dbs.UNKNOWN, async (s, stmts) => { await s.batch(stmts); throw Error('synthetic-secret-response'); });
    await assert.rejects(step(readonlySource, lostResponse, runId, 0, scope), /^Error: COPY_COMMIT_UNCONFIRMED$/);
    cp = await status(dbs.UNKNOWN, runId, scope); assert.equal(cp.revision, 1);
    await assert.rejects(step(readonlySource, dbs.UNKNOWN, runId, 0, scope), /^Error: COPY_STALE_REVISION$/);
    cp = await step(readonlySource, dbs.UNKNOWN, runId, cp.revision, scope);
    assert.equal(cp.rowsCopied, 1); assert.equal((await dbs.UNKNOWN.prepare('SELECT count(*) n FROM user').first()).n, 1);

    // A failure at the very end rolls back both the data INSERT and checkpoint.
    await start(dbs.ROLLBACK, runId, scope);
    const lateFailure = intercept(dbs.ROLLBACK, (s, stmts) => s.batch([...stmts, s.prepare("INSERT INTO cockpit_atomic_assertion(id,ok) VALUES ('fault',0)")]));
    await assert.rejects(step(readonlySource, lateFailure, runId, 0, scope), /^Error: COPY_COMMIT_UNCONFIRMED$/);
    assert.equal((await status(dbs.ROLLBACK, runId, scope)).revision, 0);
    assert.equal((await dbs.ROLLBACK.prepare('SELECT count(*) n FROM user').first()).n, 0);
    assert.equal((await dbs.ROLLBACK.prepare('SELECT count(*) n FROM cockpit_atomic_assertion').first()).n, 0);
    const beforeCommit = intercept(dbs.ROLLBACK, () => { throw Error('synthetic-secret-before-commit'); });
    await assert.rejects(step(readonlySource, beforeCommit, runId, 0, scope), /^Error: COPY_COMMIT_UNCONFIRMED$/);
    assert.equal((await status(dbs.ROLLBACK, runId, scope)).revision, 0);
    await step(readonlySource, dbs.ROLLBACK, runId, 0, scope);

    // Refuse occupied destinations, legacy migration records and weakened assertion schema.
    await dbs.GUARD.prepare("INSERT INTO security_counter VALUES ('occupied',0,1)").run();
    await assert.rejects(start(dbs.GUARD, runId, scope), /^Error: COPY_INITIALIZE_UNCONFIRMED$/);
    await dbs.GUARD.prepare('DELETE FROM security_counter').run();
    await dbs.GUARD.prepare('CREATE TABLE cockpit_cutover_receipt(id TEXT PRIMARY KEY)').run();
    await dbs.GUARD.prepare("INSERT INTO cockpit_cutover_receipt VALUES ('old-run')").run();
    await assert.rejects(start(dbs.GUARD, runId, scope), /^Error: COPY_INITIALIZE_UNCONFIRMED$/);
    await dbs.GUARD.prepare('DELETE FROM cockpit_cutover_receipt').run();
    await dbs.GUARD.prepare('DROP TABLE cockpit_atomic_assertion').run();
    await dbs.GUARD.prepare('CREATE TABLE cockpit_atomic_assertion(id TEXT PRIMARY KEY,ok INTEGER NOT NULL)').run();
    await assert.rejects(start(dbs.GUARD, runId, scope), /^Error: COPY_SCHEMA_MISMATCH$/);
    await dbs.GUARD.prepare('DROP TABLE cockpit_atomic_assertion').run();
    await dbs.GUARD.exec(fs.readFileSync('cloudflare/d1/schema.sql', 'utf8').replace(/--[^\n]*/g, '').replace(/\n/g, ' '));
    await start(dbs.GUARD, runId, scope);
    await dbs.GUARD.prepare('CREATE TRIGGER unsafe_copy AFTER INSERT ON user BEGIN SELECT 1; END').run();
    await assert.rejects(step(readonlySource, dbs.GUARD, runId, 0, scope), /^Error: COPY_SCHEMA_MISMATCH$/);
    await dbs.GUARD.prepare('DROP TRIGGER unsafe_copy').run();
    await source.execute("UPDATE user SET email='other@example.invalid'");
    await assert.rejects(step(readonlySource, dbs.GUARD, runId, 0, scope), /^Error: COPY_OWNER_MISMATCH$/);
    await source.execute("UPDATE user SET email='owner@example.invalid'");
    await source.execute("UPDATE user SET email_verified=0");
    await assert.rejects(step(readonlySource, dbs.GUARD, runId, 0, scope), /^Error: COPY_OWNER_MISMATCH$/);
    await source.execute("UPDATE user SET email_verified=1,name=?", ['x'.repeat(65536)]);
    await assert.rejects(step(readonlySource, dbs.GUARD, runId, 0, scope), /^Error: BOUNDED_ROW_TOO_LARGE$/);
    assert.equal((await status(dbs.GUARD, runId, scope)).revision, 0);
    assert.equal((await dbs.GUARD.prepare('SELECT count(*) n FROM user').first()).n, 0);
    await source.execute("UPDATE user SET name='synthetic'");

    // An externally inserted duplicate must roll the checkpoint back, never replace it.
    await dbs.GUARD.prepare("INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('owner','preserve-existing','owner@example.invalid',1,1,1)").run();
    await assert.rejects(step(readonlySource, dbs.GUARD, runId, 0, scope), /^Error: COPY_COMMIT_UNCONFIRMED$/);
    assert.equal((await status(dbs.GUARD, runId, scope)).revision, 0);
    assert.equal((await dbs.GUARD.prepare("SELECT name FROM user WHERE id='owner'").first()).name, 'preserve-existing');
    await dbs.GUARD.prepare('DELETE FROM user').run();

    // Inject aggregate boundary fixtures, then try one real bounded source row.
    for (const fixture of [
      { table: 'record', rows: 2000, bytes: 0, inTable: 0, cursor: null },
      { table: 'record', rows: 1000, bytes: 0, inTable: 1000, cursor: '["",""]' },
      { table: 'session', rows: 100, bytes: 0, inTable: 100, cursor: '[""]' },
      { table: 'user', rows: 0, bytes: 16 * 1024 * 1024, inTable: 0, cursor: null },
    ]) {
      const index = defs.findIndex(d => d.name === fixture.table), revision = fixture.rows + index;
      await dbs.GUARD.prepare('UPDATE cockpit_copy_checkpoint SET table_index=?,revision=?,total_rows=?,total_bytes=?,table_rows=?,cursor_json=?')
        .bind(index, revision, fixture.rows, fixture.bytes, fixture.inTable, fixture.cursor).run();
      const before = await status(dbs.GUARD, runId, scope);
      await assert.rejects(step(readonlySource, dbs.GUARD, runId, revision, scope), /^Error: COPY_CAPACITY_EXCEEDED$/);
      assert.deepEqual(await status(dbs.GUARD, runId, scope), before);
      assert.equal((await dbs.GUARD.prepare(`SELECT count(*) n FROM ${quote(fixture.table)}`).first()).n, 0);
    }
    await dbs.GUARD.prepare('UPDATE cockpit_copy_checkpoint SET table_index=0,total_bytes=0').run();
    await dbs.GUARD.prepare("UPDATE cockpit_copy_checkpoint SET cursor_json='[1]',table_rows=1,total_rows=1,revision=1").run();
    await assert.rejects(status(dbs.GUARD, runId, scope), /^Error: COPY_CHECKPOINT_INVALID$/);
    console.log('PASS bounded copy checkpoints: all 18 tables, durable runtime restart, exact text bytes, atomic concurrent winner, response-loss recovery, full rollback, no overwrite/activation, owner/schema/capacity guards');
  } finally { source.close(); await mf.dispose(); fs.rmSync(temporary, { recursive: true, force: true }); fs.rmSync(output, { force: true }); }
};
if (require.main === module) module.exports().catch(e => { console.error(e); process.exitCode = 1; });
