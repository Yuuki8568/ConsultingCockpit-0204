// Synthetic local libSQL only. No production credentials, writes or endpoints.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const dep = require('node:module').createRequire(require.resolve('wrangler'));
const { build } = dep('esbuild');
const { createClient } = require('@libsql/client');

module.exports = async function runBoundedReaderTests() {
  const output = 'packages/web/tests/.d1-bounded-reader-test.mjs';
  await build({ entryPoints: ['security-ops/d1-bounded-reader.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: output });
  const { readBoundedMigrationRow: read, BOUNDED_ROW_JSON_BYTES: ceiling } = await import(require('node:url').pathToFileURL(path.resolve(output)));
  const temporary = fs.mkdtempSync('/tmp/cockpit-bounded-reader-');
  const source = createClient({ url: 'file:' + temporary + '/source.sqlite', intMode: 'bigint' });
  const statements = [], payloads = [];
  let commits = 0;
  const wrapped = { async transaction(mode) {
    assert.equal(mode, 'read');
    const tx = await source.transaction(mode);
    return new Proxy(tx, { get(t, k) {
      if (k === 'execute') return async statement => {
        assert.match(statement.sql, /^SELECT /); assert.ok(!/\bOFFSET\b/i.test(statement.sql));
        statements.push(statement); const result = await t.execute(statement);
        if (statement.sql.includes(' AS _bytes,')) payloads.push(result.rows);
        return result;
      };
      if (k === 'commit') return async () => { commits++; return t.commit(); };
      const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
    }});
  }};
  try {
    const schema = fs.readFileSync('cloudflare/d1/business-schema.sql', 'utf8');
    await source.executeMultiple(schema);
    const ids = ['a', 'A', 'a\u0000b', 'quote\'?', '\ufeffBOM', '\ue000', '\u{1f600}', '日本語'];
    for (let i = 0; i < 28; i++) ids.push('row-' + String(i).padStart(2, '0'));
    const cipher = 'synthetic-\u0000-"-\\-日本語-\u{1f600}';
    for (const user of ['owner-b', 'owner-a']) for (const id of ids) await source.execute({
      sql: 'INSERT INTO record(id,user_id,type,ciphertext,iv,updated_at_ms) VALUES (?,?,?,?,?,?)',
      args: [id, user, 'case', cipher, 'synthetic-iv', 1],
    });
    const expected = (await source.execute('SELECT * FROM record ORDER BY user_id COLLATE BINARY,id COLLATE BINARY')).rows;
    let cursor = null; const found = [];
    for (const row of expected) {
      const page = await read(wrapped, 'record', cursor);
      assert.equal(page.done, false);
      // Native libSQL's plain TEXT result truncates NUL; expected keys are
      // read as hex independently so this test never blesses that truncation.
      const expectedKey = (await source.execute({ sql: 'SELECT hex(user_id) u,hex(id) i FROM record ORDER BY user_id COLLATE BINARY,id COLLATE BINARY LIMIT 1 OFFSET ?', args: [found.length] })).rows[0];
      assert.deepEqual(page.cursor, [Buffer.from(expectedKey.u, 'hex').toString('utf8'), Buffer.from(expectedKey.i, 'hex').toString('utf8')]);
      assert.equal(page.values[page.columns.indexOf('ciphertext')], cipher);
      assert.equal(page.jsonBytes, Buffer.byteLength(JSON.stringify(page.values)));
      assert.ok(page.jsonBytes <= ceiling);
      // A retry before a checkpoint repeats the row instead of advancing it.
      assert.deepEqual(await read(wrapped, 'record', cursor), page);
      found.push(page.cursor); cursor = page.cursor;
    }
    assert.deepEqual(await read(wrapped, 'record', cursor), { done: true });
    assert.equal(found.length, ids.length * 2); assert.equal(new Set(found.map(JSON.stringify)).size, found.length);
    assert.equal(commits, expected.length * 2 + 1);
    const seek = statements.find(s => s.sql.includes(' AS _bytes,') && s.args.length);
    const explain = createClient({ url: 'file:' + temporary + '/source.sqlite' });
    try {
      const plan = await explain.execute({ sql: 'EXPLAIN QUERY PLAN ' + seek.sql, args: seek.args });
      assert.match(plan.rows.map(r => r.detail).join('\n'), /SEARCH _source USING INDEX .*\(\(user_id,id\)>\(\?,\?\)\)/);
      assert.ok(!plan.rows.some(r => /TEMP B-TREE/.test(r.detail)));
    } finally { explain.close(); }
    assert.deepEqual((await source.execute('SELECT * FROM record ORDER BY user_id COLLATE BINARY,id COLLATE BINARY')).rows, expected);

    // Every current table's actual primary-key layout is supported, even empty.
    for (const table of ['user', 'account', 'session', 'verification', 'rate_limit', 'vault', 'device', 'device_session', 'login_event', 'audit_event', 'audit_head', 'passkey_credential', 'security_challenge', 'step_up_ticket', 'security_counter', 'write_identity', 'record_revision'])
      assert.deepEqual(await read(wrapped, table, null), { done: true });
    await source.execute("INSERT INTO security_counter(key,window_start,count) VALUES ('single-key',0,1)");
    assert.deepEqual((await read(wrapped, 'security_counter', null)).cursor, ['single-key']);
    assert.deepEqual(await read(wrapped, 'security_counter', ['single-key']), { done: true });
    assert.deepEqual(await read(wrapped, 'security_counter', ["x'); DROP TABLE user; --"]), { done: true });
    assert.equal((await source.execute('SELECT count(*) n FROM user')).rows[0].n, 0n);

    const beforeCalls = statements.length;
    for (const bad of [[], ['one'], ['a', null], ['a', 1], ['a', '\ud800'], ['a', 'x'.repeat(ceiling + 1)], 'text'])
      await assert.rejects(read(wrapped, 'record', bad), /^Error: BOUNDED_INVALID_CURSOR$/);
    for (const bad of [NaN, -1, 10, ceiling + 1, 1.5]) await assert.rejects(read(wrapped, 'record', null, bad), /BOUNDED_INVALID_LIMIT/);
    await assert.rejects(read(wrapped, 'record; DROP TABLE user', null), /BOUNDED_UNKNOWN_TABLE/);
    assert.equal(statements.length, beforeCalls);

    // Immediate oversized row blocks: no payload or key crosses the boundary,
    // and the following small row is not mistaken for the next safe row.
    await source.execute('DELETE FROM record');
    const big = 'synthetic-private-oversized-' + 'x'.repeat(ceiling);
    await source.execute({ sql: 'INSERT INTO record(id,user_id,type,ciphertext,iv,updated_at_ms) VALUES (?,?,?,?,?,0)', args: ['a-large', 'owner', 'case', big, 'iv'] });
    await source.execute({ sql: 'INSERT INTO record(id,user_id,type,ciphertext,iv,updated_at_ms) VALUES (?,?,?,?,?,0)', args: ['z-small', 'owner', 'case', 'small', 'iv'] });
    for (const after of [null, ['owner', '0']]) {
      await assert.rejects(read(wrapped, 'record', after), /^Error: BOUNDED_ROW_TOO_LARGE$/);
      const blocked = payloads.at(-1)[0];
      for (const [key, value] of Object.entries(blocked)) if (!key.startsWith('_')) assert.equal(value, null);
    }
    await source.execute("UPDATE record SET ciphertext=x'0102' WHERE id='a-large'");
    await assert.rejects(read(wrapped, 'record', null), /^Error: BOUNDED_UNSUPPORTED_VALUE$/);
    assert.equal(payloads.at(-1)[0].ciphertext, null);
    await source.execute("UPDATE record SET ciphertext='small',updated_at_ms=9007199254740992 WHERE id='a-large'");
    await assert.rejects(read(wrapped, 'record', null), /^Error: BOUNDED_UNSUPPORTED_VALUE$/);
    await source.execute("UPDATE record SET updated_at_ms=0 WHERE id='a-large'");
    await source.execute("UPDATE record SET ciphertext=CAST(x'FFFE' AS TEXT) WHERE id='a-large'");
    await assert.rejects(read(wrapped, 'record', null), /^Error: BOUNDED_UNSUPPORTED_VALUE$/);
    await source.execute("UPDATE record SET ciphertext='small' WHERE id='a-large'");
    // The raw-byte guard can reject a row conservatively before actual JSON size.
    await assert.rejects(read(wrapped, 'record', null, 70), /^Error: BOUNDED_ROW_TOO_LARGE$/);
    assert.equal((await read(wrapped, 'record', null)).done, false);

    // Incorrect ordering assumptions cannot silently alter traversal.
    await source.execute('DROP TABLE security_counter');
    for (const keyDef of ['TEXT PRIMARY KEY', 'TEXT PRIMARY KEY NOT NULL COLLATE NOCASE', 'TEXT PRIMARY KEY DESC NOT NULL', 'INTEGER PRIMARY KEY NOT NULL']) {
      await source.execute(`CREATE TABLE security_counter(key ${keyDef},window_start INTEGER NOT NULL,count INTEGER NOT NULL)`);
      await assert.rejects(read(wrapped, 'security_counter', null), /^Error: BOUNDED_SCHEMA_MISMATCH$/);
      await source.execute('DROP TABLE security_counter');
    }
    // A column's default collation must not override the validated PK order.
    await source.execute('CREATE TABLE security_counter(key TEXT COLLATE NOCASE NOT NULL,window_start INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(key COLLATE BINARY))');
    await source.execute("INSERT INTO security_counter VALUES ('A',0,1),('a',0,1),('B',0,1)");
    assert.deepEqual((await read(wrapped, 'security_counter', ['A'])).cursor, ['B']);
    assert.deepEqual((await read(wrapped, 'security_counter', ['B'])).cursor, ['a']);
    assert.ok(statements.every(s => Buffer.byteLength(s.sql) < 100000));
    await source.execute('ALTER TABLE record ADD COLUMN extra TEXT');
    await assert.rejects(read(wrapped, 'record', null), /^Error: BOUNDED_SCHEMA_MISMATCH$/);
    await assert.rejects(read({ transaction: async () => { throw Error('synthetic-private-connect-token'); } }, 'user', null), /^Error: BOUNDED_QUERY_FAILED$/);
    for (const failure of ['execute', 'commit', 'close']) {
      const broken = { async transaction(mode) {
        const tx = await source.transaction(mode);
        return new Proxy(tx, { get(t, k) {
          if (k === failure) return () => { if (k === 'close') t.close(); throw Error('synthetic-private-query-token'); };
          const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
        }});
      }};
      await assert.rejects(read(broken, 'user', null), /^Error: BOUNDED_QUERY_FAILED$/);
    }
    console.log('PASS bounded D1 source reader: indexed composite/single-key traversal, repeatable reads, all 18 tables, byte guard before payload transfer, no oversized-row skipping, schema/type rejection and redacted errors');
  } finally { source.close(); fs.rmSync(temporary, { recursive: true, force: true }); fs.rmSync(output, { force: true }); }
};
if (require.main === module) module.exports().catch(e => { console.error(e); process.exitCode = 1; });
