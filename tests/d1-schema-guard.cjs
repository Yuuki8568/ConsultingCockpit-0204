// Synthetic local SQLite/libSQL + Miniflare only. Never opens the production DB.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const dep = require('node:module').createRequire(require.resolve('wrangler'));
const { build } = dep('esbuild'), { Miniflare, convertV4MiniflareOptions } = dep('miniflare');
const { createClient } = require('@libsql/client');

module.exports = async function runSchemaGuardTests() {
  const output = 'packages/web/tests/.d1-schema-guard-test.mjs';
  await build({ stdin: { contents: `export * from './security-ops/d1-schema-guard.ts'; export * from './security-ops/d1-schema-contract.ts'; export * from './security-ops/d1-free-preflight.ts'; export * from './security-ops/d1-bounded-reader.ts'; export * from './security-ops/d1-copy-checkpoint.ts'`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: output });
  const { assertBusinessSchema: schemaCheck, assertBusinessForeignKeys: fkCheck, BUSINESS_SCHEMA_CONTRACT: contract,
    inspectFreeMigrationTable: preflight, readBoundedMigrationRow: read, initializeBoundedCopy: start,
    copyBoundedStep: copy, getBoundedCopyStatus: status, COPY_CHECKPOINT_SCHEMA } = await import(require('node:url').pathToFileURL(path.resolve(output)));
  const temporary = fs.mkdtempSync('/tmp/cockpit-schema-guard-');
  const source = createClient({ url: 'file:' + temporary + '/source.sqlite' });
  const names = ['GOOD', 'INDEX', 'COPY', 'TRIGGER'];
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("synthetic")}}', compatibilityDate: '2026-10-17', d1Databases: names }));
  const query = client => async (sql, args) => { assert.match(sql, /^SELECT /); return (await client.execute({ sql, args })).rows; };
  const targetQuery = db => async (sql, args) => { assert.match(sql, /^SELECT /); return (await db.prepare(sql).bind(...args).all()).results; };
  const hash = text => createHash('sha256').update(text).digest('hex');
  const schema = fs.readFileSync('cloudflare/d1/business-schema.sql', 'utf8');
  const statements = sql => sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
  const scope = { maintenanceConfirmed: true, destinationDetached: true, sourceIdentitySha256: 'a'.repeat(64), ownerEmails: ['owner@example.invalid'] };
  const runId = '00000000-0000-4000-8000-000000000001';
  try {
    await source.executeMultiple(schema);
    const dbs = {};
    for (const name of names) {
      const db = dbs[name] = await mf.getD1Database(name);
      await db.batch(statements(schema + fs.readFileSync('cloudflare/d1/schema.sql', 'utf8')).map(s => db.prepare(s)));
      await db.prepare(COPY_CHECKPOINT_SCHEMA).run();
    }
    // Pinning is independent of the verifier: Node crypto over actual SQLite DDL.
    // This also makes an unreviewed edit of business-schema.sql fail existing CI.
    assert.equal(contract.length, 18);
    for (const item of contract) {
      const actual = (await source.execute({ sql: 'SELECT type,name,sql FROM sqlite_schema WHERE tbl_name=? ORDER BY type,name', args: [item.table] })).rows;
      assert.deepEqual(actual.map(r => ({ type: r.type, name: r.name, sqlSha256: r.sql === null ? null : hash(r.sql) })), item.objects);
      await schemaCheck(query(source), item.table); await fkCheck(query(source), item.table);
      await schemaCheck(targetQuery(dbs.GOOD), item.table); await fkCheck(targetQuery(dbs.GOOD), item.table);
    }
    const mutations = [
      ['user', s => s.replace('`name` text NOT NULL', '`name` text')],
      ['user', s => s.replace('`name` text NOT NULL', '`name` integer NOT NULL')],
      ['vault', s => s.replace("DEFAULT 'PBKDF2-SHA256'", "DEFAULT 'pbkdf2-sha256'")],
      ['vault', s => s.replace("DEFAULT 'PBKDF2-SHA256'", "DEFAULT 'PBKDF2- SHA256'")],
      ['record', s => s.replace('PRIMARY KEY(`user_id`, `id`)', 'PRIMARY KEY(`id`, `user_id`)')],
      ['account', s => s.replace('ON DELETE cascade', 'ON DELETE restrict')],
      ['account', s => s.replace(',\n\tFOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade', '')],
      ['user', s => s.replace('CREATE UNIQUE INDEX `user_email_unique`', 'CREATE INDEX `user_email_unique`')],
      ['user', s => s.replace('ON `user` (`email`)', 'ON `user` (`email` COLLATE NOCASE)')],
      ['user', s => s.replace('ON `user` (`email`)', 'ON `user` (`email`) WHERE email_verified=1')],
      ['record', s => s.replace('ON `record` (`user_id`,`seq`)', 'ON `record` (`user_id`,`seq` DESC)')],
      ['user', s => s + 'CREATE INDEX extra_user_name ON user(name);'],
      ['user', s => s + 'CREATE TRIGGER hidden_side_effect AFTER INSERT ON user BEGIN SELECT 1; END;'],
      ['security_counter', s => s + 'DROP TABLE security_counter; CREATE VIEW security_counter AS SELECT 1 AS key,0 AS window_start,0 AS count;'],
      // Guard the bytes before returning them, even in unexpected metadata.
      ['user', s => s.replace('`name` text NOT NULL', '`name` text NOT NULL /*' + 'x'.repeat(17000) + '*/')],
      ['user', s => s + 'CREATE INDEX "' + 'x'.repeat(5000) + '" ON user(name);'],
      ['user', s => s + Array.from({ length: 12 }, (_, i) => `CREATE INDEX extra_${i} ON user(name);`).join('')],
    ];
    for (let i = 0; i < mutations.length; i++) {
      const [table, mutate] = mutations[i], changed = mutate(schema);
      assert.notEqual(changed, schema, 'fixture must change the actual DDL');
      const wrong = createClient({ url: 'file:' + temporary + '/wrong-' + i + '.sqlite' });
      try {
        await wrong.executeMultiple(changed);
        const bounded = async (sql, args) => {
          const rows = await query(wrong)(sql, args);
          assert.ok(rows.length <= contract.find(c => c.table === table).objects.length + 1);
          for (const r of rows) { assert.ok(r.ddl == null || r.ddl.length <= 32768); assert.ok(r.name == null || Buffer.byteLength(r.name) <= 128); }
          return rows;
        };
        await assert.rejects(schemaCheck(bounded, table), /^Error: SCHEMA_DEFINITION_MISMATCH$/, 'schema fixture ' + i);
        await assert.rejects(read(wrong, table, null), /^Error: BOUNDED_SCHEMA_MISMATCH$/);
        await assert.rejects(preflight(wrong, dbs.GOOD, table, ['owner@example.invalid']), /^Error: PREFLIGHT_SOURCE_SCHEMA_MISMATCH$/);
      } finally { wrong.close(); }
    }
    let called = false;
    const never = async () => { called = true; throw Error('must not call'); };
    await assert.rejects(schemaCheck(never, 'user; DROP TABLE user'), /^Error: SCHEMA_UNKNOWN_TABLE$/);
    await assert.rejects(fkCheck(never, 'unknown'), /^Error: SCHEMA_UNKNOWN_TABLE$/);
    assert.equal(called, false);
    const broken = async () => { throw Error('synthetic-private-query-token'); };
    await assert.rejects(schemaCheck(broken, 'user'), /^Error: SCHEMA_QUERY_FAILED$/);
    await assert.rejects(fkCheck(broken, 'user'), /^Error: SCHEMA_QUERY_FAILED$/);

    // Related IDs are never returned. A malformed source blocks preflight and
    // the table boundary in bounded reads; a missing FK in DDL cannot bypass it.
    await source.execute('PRAGMA foreign_keys=OFF');
    await source.execute("INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES ('synthetic-private-id','a','p','missing-private-owner',0,0)");
    await assert.rejects(fkCheck(query(source), 'account'), /^Error: SCHEMA_FOREIGN_KEY_MISMATCH$/);
    await assert.rejects(preflight(source, dbs.GOOD, 'account', ['owner@example.invalid']), /^Error: PREFLIGHT_SOURCE_FOREIGN_KEY_MISMATCH$/);
    await assert.rejects(read(source, 'account', ['synthetic-private-id']), /^Error: BOUNDED_FOREIGN_KEY_MISMATCH$/);
    await source.execute('DELETE FROM account');
    await source.execute("INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('owner','synthetic','owner@example.invalid',1,0,0)");

    await dbs.INDEX.prepare('DROP INDEX user_email_unique').run();
    await dbs.INDEX.prepare('CREATE INDEX user_email_unique ON user(email)').run();
    await assert.rejects(preflight(source, dbs.INDEX, 'user', ['owner@example.invalid']), /^Error: PREFLIGHT_DESTINATION_SCHEMA_MISMATCH$/);
    await assert.rejects(start(dbs.INDEX, runId, scope), /^Error: COPY_SCHEMA_MISMATCH$/);
    assert.equal((await dbs.INDEX.prepare('SELECT count(*) n FROM cockpit_copy_checkpoint').first()).n, 0);
    await start(dbs.COPY, runId, scope);
    await dbs.COPY.prepare('DROP INDEX user_email_unique').run();
    await assert.rejects(copy(source, dbs.COPY, runId, 0, scope), /^Error: COPY_SCHEMA_MISMATCH$/);
    assert.equal((await status(dbs.COPY, runId, scope)).revision, 0);
    assert.equal((await dbs.COPY.prepare('SELECT count(*) n FROM user').first()).n, 0);
    await dbs.TRIGGER.prepare('CREATE TRIGGER hidden_side_effect AFTER INSERT ON user BEGIN SELECT 1; END').run();
    await assert.rejects(schemaCheck(targetQuery(dbs.TRIGGER), 'user'), /^Error: SCHEMA_DEFINITION_MISMATCH$/);
    assert.equal((await dbs.GOOD.prepare('SELECT count(*) n FROM user').first()).n, 0);
    // Existing copies made under the older, weaker schema binding are refused.
    const old = hash(JSON.stringify(['cockpit-d1-stream-v2', []]));
    await dbs.COPY.prepare('UPDATE cockpit_copy_checkpoint SET schema_hash=?').bind(old).run();
    await assert.rejects(status(dbs.COPY, runId, scope), /^Error: COPY_CONTEXT_MISMATCH$/);
    console.log('PASS D1 schema guards: 18 pinned definitions on libSQL/D1, 17 incompatible schema fixtures, foreign-key integrity, bounded metadata, copy refusal before mutation, old binding refusal, redacted errors');
  } finally { source.close(); await mf.dispose(); fs.rmSync(temporary, { recursive: true, force: true }); fs.rmSync(output, { force: true }); }
};
if (require.main === module) module.exports().catch(e => { console.error(e); process.exitCode = 1; });
