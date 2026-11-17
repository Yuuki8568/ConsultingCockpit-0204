// Called by the local synthetic copy suite. No real data, credentials or network DB.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const dep = require('node:module').createRequire(require.resolve('wrangler'));
const { build } = dep('esbuild'), { Miniflare, convertV4MiniflareOptions } = dep('miniflare');
module.exports = async function verifyCopies({ source, template, defs, scope, runId }) {
  const output = 'packages/web/tests/.d1-copy-verification-test.mjs';
  await build({ stdin: { contents: `export * from './security-ops/d1-copy-verification.ts'; export * from './security-ops/d1-copy-checkpoint.ts'`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: output });
  const { initializeCopyVerification: start, getCopyVerificationStatus: status, verifyCopyStep: rawStep, COPY_VERIFICATION_SCHEMA, COPY_CHECKPOINT_SCHEMA } = await import(require('node:url').pathToFileURL(path.resolve(output)));
  const witnessHash = (await template.prepare('SELECT hash FROM audit_head').first()).hash;
  const witness = { async fetch(request) { assert.equal(request.method, 'GET'); assert.equal(request.url, 'https://witness/head?user=owner'); return Response.json({ seq: 2, hash: witnessHash }); } };
  const step = (input, target, id, revision, options, service = witness) => rawStep(input, target, id, revision, options, service);
  const tmp = fs.mkdtempSync('/tmp/cockpit-verify-copy-');
  const names = ['GOOD', 'TARGET', 'SOURCE', 'RACE', 'LOSS', 'ROLLBACK', 'BLOB', 'AUDIT', 'ANCHOR', 'CHANGED', 'UNAVAILABLE', 'HEAD', 'PREVIOUS'];
  const opts = { modules: true, script: 'export default {fetch(){return new Response("synthetic")}}', compatibilityDate: '2026-10-17', d1Databases: names, resourcePersistencePath: tmp + '/d1' };
  let mf = new Miniflare(convertV4MiniflareOptions(opts));
  const quote = c => '"' + c.replaceAll('"', '""') + '"', databases = {};
  const hash = x => require('node:crypto').createHash('sha256').update(JSON.stringify(x), 'utf8').digest('hex');
  const readonly = { async transaction(mode) { assert.equal(mode, 'read'); const tx = await source.transaction(mode); return new Proxy(tx, { get(t, k) {
    if (k === 'execute') return st => { assert.match(st.sql, /^SELECT /); return t.execute(st); };
    const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
  }}); }};
  const wrapBatch = (db, fn) => new Proxy(db, { get(t, k) {
    if (k === 'withSession') return option => { assert.equal(option, 'first-primary'); const session = t.withSession(option);
      return new Proxy(session, { get(s, key) { if (key === 'batch') return stmts => fn(s, stmts); const v = s[key]; return typeof v === 'function' ? v.bind(s) : v; }});
    };
    const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
  }});
  const advance = async (db, until, input = readonly) => {
    let p = await status(db, runId, scope);
    for (let n = 0; n < 100 && p.phase !== until; n++) p = await step(input, db, runId, p.revision, scope);
    assert.equal(p.phase, until); return p;
  };
  try {
    const baseline = await template.prepare('SELECT * FROM cockpit_copy_checkpoint').first();
    const copied = [];
    let digest = hash(['cockpit-d1-stream-v2', 'start', runId, hash(['cockpit-d1-stream-v2', defs]), hash([scope.sourceIdentitySha256, scope.ownerEmails])]);
    let rows = 0, bytes = 0;
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i], entries = (await template.prepare(`SELECT * FROM ${quote(def.name)} ORDER BY ${def.keys.map(c => quote(c) + ' COLLATE BINARY').join(',')}`).all()).results;
      copied.push({ def, entries });
      for (const row of entries) {
        const values = def.columns.map(c => row[c]); rows++; bytes += Buffer.byteLength(JSON.stringify(values));
        digest = hash(['cockpit-d1-stream-v2', 'row', digest, i, values]);
      }
      digest = hash(['cockpit-d1-stream-v2', 'table-end', digest, i, entries.length, rows, bytes]);
    }
    assert.equal(baseline.copy_hash, digest); assert.equal(rows, 20); assert.equal(bytes, baseline.total_bytes);
    const schema = (fs.readFileSync('cloudflare/d1/business-schema.sql', 'utf8') + fs.readFileSync('cloudflare/d1/schema.sql', 'utf8')).replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
    for (const name of names) {
      const db = databases[name] = await mf.getD1Database(name);
      await db.batch([...schema.map(s => db.prepare(s)), db.prepare(COPY_CHECKPOINT_SCHEMA), db.prepare(COPY_VERIFICATION_SCHEMA)]);
      // Detached synthetic clones only, including the independently checked copy hash.
      for (const { def, entries } of copied) for (const row of entries) await db.prepare(`INSERT INTO ${quote(def.name)} (${def.columns.map(quote).join(',')}) VALUES (${def.columns.map(() => '?').join(',')})`).bind(...def.columns.map(c => row[c])).run();
      const keys = Object.keys(baseline);
      await db.prepare(`INSERT INTO cockpit_copy_checkpoint (${keys.map(quote).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map(k => baseline[k])).run();
    }
    await assert.rejects(status(databases.GOOD, runId, scope), /^Error: VERIFY_NOT_STARTED$/);
    let p = await start(databases.GOOD, runId, scope);
    await assert.rejects(start(databases.GOOD, runId, scope), /^Error: VERIFY_INITIALIZE_UNCONFIRMED$/);
    await assert.rejects(step(readonly, databases.GOOD, runId, 0, { ...scope, sourceIdentitySha256: 'b'.repeat(64) }), /^Error: COPY_CONTEXT_MISMATCH$/);
    for (let i = 0; i < 5; i++) p = await step(readonly, databases.GOOD, runId, p.revision, scope);
    await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions(opts));
    for (const name of names) databases[name] = await mf.getD1Database(name);
    assert.deepEqual(await status(databases.GOOD, runId, scope), p);
    p = await advance(databases.GOOD, 'matched');
    assert.equal(p.revision, 77); assert.equal(p.dataMatched, true); assert.equal(p.verified, false); assert.equal(p.auditVerified, true); assert.equal(p.cutoverAllowed, false);
    assert.equal((await databases.GOOD.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='cockpit_cutover_receipt'").first()).n, 0);

    await start(databases.TARGET, runId, scope);
    await databases.TARGET.prepare("UPDATE record SET iv='xx' WHERE id='z-last'").run(); // same byte count, different value
    await assert.rejects(advance(databases.TARGET, 'matched'), /^Error: VERIFY_CONTENT_MISMATCH$/);
    p = await status(databases.TARGET, runId, scope); assert.equal(p.phase, 'failed'); assert.equal(p.dataMatched, false);
    await assert.rejects(step(readonly, databases.TARGET, runId, p.revision, scope), /^Error: VERIFY_ALREADY_FAILED$/);
    await assert.rejects(start(databases.TARGET, runId, scope), /^Error: VERIFY_INITIALIZE_UNCONFIRMED$/);

    await start(databases.SOURCE, runId, scope); p = await advance(databases.SOURCE, 'source');
    const failedSource = { async transaction() { throw Error('synthetic-secret-connection'); } };
    await assert.rejects(step(failedSource, databases.SOURCE, runId, p.revision, scope), /^Error: VERIFY_QUERY_FAILED$/);
    assert.deepEqual(await status(databases.SOURCE, runId, scope), p);
    await source.execute("UPDATE record SET iv='xx' WHERE id='z-last'");
    try { await assert.rejects(advance(databases.SOURCE, 'matched'), /^Error: VERIFY_CONTENT_MISMATCH$/); }
    finally { await source.execute("UPDATE record SET iv='iv' WHERE id='z-last'"); }
    assert.equal((await status(databases.SOURCE, runId, scope)).phase, 'failed');

    await start(databases.RACE, runId, scope);
    const race = await Promise.allSettled([step(readonly, databases.RACE, runId, 0, scope), step(readonly, databases.RACE, runId, 0, scope)]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await status(databases.RACE, runId, scope)).revision, 1);
    await assert.rejects(step(readonly, databases.RACE, runId, 0, scope), /^Error: VERIFY_STALE_REVISION$/);

    await start(databases.LOSS, runId, scope);
    const lost = wrapBatch(databases.LOSS, async (db, stmts) => { await db.batch(stmts); throw Error('synthetic-secret-response'); });
    await assert.rejects(step(readonly, lost, runId, 0, scope), /^Error: VERIFY_COMMIT_UNCONFIRMED$/);
    assert.equal((await status(databases.LOSS, runId, scope)).revision, 1);
    await advance(databases.LOSS, 'matched');

    await start(databases.ROLLBACK, runId, scope);
    const late = wrapBatch(databases.ROLLBACK, (db, stmts) => db.batch([...stmts, db.prepare("INSERT INTO cockpit_atomic_assertion(id,ok) VALUES ('fail',0)")]));
    await assert.rejects(step(readonly, late, runId, 0, scope), /^Error: VERIFY_COMMIT_UNCONFIRMED$/);
    assert.equal((await status(databases.ROLLBACK, runId, scope)).revision, 0);
    assert.equal((await databases.ROLLBACK.prepare('SELECT count(*) n FROM cockpit_atomic_assertion').first()).n, 0);
    await databases.ROLLBACK.prepare("UPDATE cockpit_copy_checkpoint SET copy_hash=?").bind('b'.repeat(64)).run();
    await assert.rejects(status(databases.ROLLBACK, runId, scope), /^Error: VERIFY_CONTEXT_MISMATCH$/);

    await start(databases.BLOB, runId, scope);
    await databases.BLOB.prepare("UPDATE user SET name=x'ff'").run();
    await assert.rejects(step(readonly, databases.BLOB, runId, 0, scope), /^Error: BOUNDED_UNSUPPORTED_VALUE$/);
    assert.equal((await status(databases.BLOB, runId, scope)).phase, 'failed');

    await start(databases.AUDIT, runId, scope);
    await databases.AUDIT.prepare("UPDATE audit_event SET action='tampered'").run();
    await assert.rejects(advance(databases.AUDIT, 'matched'), /^Error: AUDIT_CHAIN_INVALID$/);
    assert.equal((await status(databases.AUDIT, runId, scope)).phase, 'failed');
    await start(databases.HEAD, runId, scope);
    await databases.HEAD.prepare('UPDATE audit_head SET seq=3').run();
    await assert.rejects(step(readonly, databases.HEAD, runId, 0, scope), /^Error: AUDIT_HEAD_MISMATCH$/);
    await start(databases.PREVIOUS, runId, scope);
    await databases.PREVIOUS.prepare("UPDATE audit_event SET prev_hash=? WHERE seq=2").bind('b'.repeat(64)).run();
    await assert.rejects(advance(databases.PREVIOUS, 'matched'), /^Error: AUDIT_CHAIN_INVALID$/);
    await start(databases.ANCHOR, runId, scope);
    const wrongAnchor = { async fetch() { return Response.json({ seq: 1, hash: 'a'.repeat(64) }); } };
    await assert.rejects((async () => {
      let state = await status(databases.ANCHOR, runId, scope);
      for (let i = 0; i < 75; i++) state = await step(readonly, databases.ANCHOR, runId, state.revision, scope, wrongAnchor);
    })(), /^Error: AUDIT_WITNESS_MISMATCH$/);
    await start(databases.CHANGED, runId, scope); p = await advance(databases.CHANGED, 'witness');
    assert.equal(p.dataMatched, true); assert.equal(p.auditVerified, false);
    await assert.rejects(step(readonly, databases.CHANGED, runId, p.revision, scope, wrongAnchor), /^Error: AUDIT_WITNESS_MISMATCH$/);
    assert.equal((await status(databases.CHANGED, runId, scope)).phase, 'failed');
    await start(databases.UNAVAILABLE, runId, scope);
    for (const service of [
      { async fetch() { throw Error('synthetic-secret-witness'); } },
      { async fetch() { return new Response('x'.repeat(4097)); } },
      { async fetch() { return Response.json({ seq: 1, hash: 'GENESIS' }); } },
    ]) {
      await assert.rejects(step(readonly, databases.UNAVAILABLE, runId, 0, scope, service), /^Error: AUDIT_WITNESS_UNAVAILABLE$/);
      assert.equal((await status(databases.UNAVAILABLE, runId, scope)).revision, 0);
    }
    await advance(databases.UNAVAILABLE, 'matched');
    console.log('PASS independent D1 verification: v2 copy hash, 18 tables, separate target/source passes, restart, tamper quarantine, concurrent CAS, response-loss recovery, rollback, audit-chain/head/independent-witness checks, no activation');
  } finally { await mf.dispose(); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(output, { force: true }); }
};
