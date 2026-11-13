// Synthetic, local SQLite/libSQL and local D1 only. Never loads production credentials.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const dep = require('node:module').createRequire(require.resolve('wrangler'));
const { build } = dep('esbuild'), { Miniflare, convertV4MiniflareOptions } = dep('miniflare');
const { createClient } = require('@libsql/client');

module.exports = async function runFreePreflightTests() {
  const output = 'packages/web/tests/.d1-free-preflight-test.mjs';
  await build({ stdin: { contents: `export * from './security-ops/d1-free-preflight.ts'; export {migrationDefinitions} from './packages/web/src/api/database/d1/migration-schema.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: output });
  const { inspectFreeMigrationTable, planFreeD1Migration, migrationDefinitions } = await import(require('node:url').pathToFileURL(path.resolve(output)));
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("synthetic")}}', compatibilityDate: '2026-10-17', d1Databases: ['PREFLIGHT'] }));
  const temporary = fs.mkdtempSync('/tmp/cockpit-free-preflight-');
  const source = createClient({ url: 'file:' + temporary + '/source.sqlite' });
  try {
    const target = await mf.getD1Database('PREFLIGHT');
    const schema = fs.readFileSync('cloudflare/d1/business-schema.sql', 'utf8');
    await source.executeMultiple(schema);
    await target.batch(schema.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean).map(s => target.prepare(s)));
    await source.execute({ sql: 'INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,0,0)', args: ['synthetic-owner', 'synthetic', 'owner@example.invalid'] });
    const ciphertext = 'synthetic-ciphertext-\u0000-"-\\-日本語';
    await source.execute({ sql: 'INSERT INTO record(id,user_id,type,ciphertext,iv,updated_at_ms) VALUES (?,?,?,?,?,0)', args: ['case', 'synthetic-owner', 'case', ciphertext, 'synthetic-iv'] });
    const sourceStatements = [], targetStatements = [];
    let readTransactions = 0, sourceCommits = 0;
    const readOnlySource = { async transaction(mode) {
      assert.equal(mode, 'read'); readTransactions++;
      const tx = await source.transaction(mode);
      return new Proxy(tx, { get(t, k) {
        if (k === 'execute') return async statement => {
          const sql = typeof statement === 'string' ? statement : statement.sql;
          assert.match(sql, /^(SELECT|PRAGMA table_info)/); sourceStatements.push(sql);
          return t.execute(statement);
        };
        if (k === 'commit') return async () => { sourceCommits++; return t.commit(); };
        const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
      }});
    }};
    const readOnlyTarget = new Proxy(target, { get(t, k) {
      if (k === 'prepare') return sql => { assert.match(sql, /^(SELECT count|PRAGMA (table_info|index_list))/); targetStatements.push(sql); return t.prepare(sql); };
      const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
    }});
    const before = await source.execute('SELECT * FROM record');
    const tables = [];
    for (const def of migrationDefinitions) tables.push(await inspectFreeMigrationTable(readOnlySource, readOnlyTarget, def.name, [' OWNER@example.invalid ']));
    assert.equal(tables.length, 18); assert.equal(readTransactions, 18); assert.equal(sourceCommits, 18);
    const record = tables.find(t => t.table === 'record');
    assert.equal(record.rows, 1); assert.ok(record.rawBytes >= Buffer.byteLength(ciphertext));
    const values = migrationDefinitions.find(t => t.name === 'record').columns.map(c => before.rows[0][c]);
    assert.ok(record.jsonRowUpperBoundBytes >= Buffer.byteLength(JSON.stringify(values)));
    const serialized = JSON.stringify(tables);
    for (const value of [ciphertext, 'synthetic-owner', 'owner@example.invalid', 'synthetic-iv']) assert.ok(!serialized.includes(value));
    assert.deepEqual((await source.execute('SELECT * FROM record')).rows, before.rows);
    assert.equal((await target.prepare('SELECT count(*) n FROM user').first()).n, 0);
    assert.ok(sourceStatements.every(sql => !/SELECT\s+\*/.test(sql)));
    assert.ok(targetStatements.every(sql => !/SELECT\s+\*/.test(sql)));
    const usage = { rowsReadToday: 0, rowsWrittenToday: 0, workerRequestsToday: 0, accountStorageBytes: 262144, destinationStorageBytes: 262144 };
    const plan = planFreeD1Migration(tables, usage);
    assert.equal(plan.fitsPlanningReserve, true); assert.equal(plan.cutoverAllowed, false); assert.equal(plan.migrationImplemented, false);
    assert.ok(plan.stillRequired.includes('REAL_FREE_CPU_MEASUREMENT'));
    assert.ok(planFreeD1Migration(tables).planningBlockers.includes('ACCOUNT_USAGE_NOT_CHECKED'));
    for (const [key, value, code] of [
      ['rowsReadToday', 5_000_000, 'DAILY_READ_RESERVE_EXCEEDED'],
      ['rowsWrittenToday', 100_000, 'DAILY_WRITE_RESERVE_EXCEEDED'],
      ['workerRequestsToday', 100_000, 'DAILY_REQUEST_RESERVE_EXCEEDED'],
      ['accountStorageBytes', 5_000_000_000, 'ACCOUNT_STORAGE_RESERVE_EXCEEDED'],
    ]) assert.ok(planFreeD1Migration(tables, { ...usage, [key]: value }).planningBlockers.includes(code));
    assert.ok(planFreeD1Migration(tables, { ...usage, accountStorageBytes: 500_000_000, destinationStorageBytes: 500_000_000 }).planningBlockers.includes('DATABASE_STORAGE_RESERVE_EXCEEDED'));
    const mutate = (name, patch) => tables.map(t => t.table === name ? { ...t, ...patch } : t);
    assert.ok(planFreeD1Migration(mutate('record', { destinationRows: 1 }), usage).planningBlockers.includes('DESTINATION_NOT_EMPTY'));
    assert.ok(planFreeD1Migration(mutate('record', { rows: 1001 }), usage).planningBlockers.includes('CURRENT_APPLICATION_ROW_LIMIT'));
    assert.ok(planFreeD1Migration(mutate('session', { rows: 101, jsonRowUpperBoundBytes: migrationDefinitions.find(d => d.name === 'session').columns.length * 6 + 2 }), usage).planningBlockers.includes('CURRENT_APPLICATION_ROW_LIMIT'));
    const huge = 1_900_001, cols = migrationDefinitions.find(d => d.name === 'record').columns.length;
    const largePlan = planFreeD1Migration(mutate('record', { rawBytes: huge, largestRawRowBytes: huge, jsonRowUpperBoundBytes: huge * 6 + cols * 6 + 2 }), usage);
    assert.ok(largePlan.planningBlockers.includes('D1_ROW_SIZE_REQUIRES_REDESIGN'));
    assert.ok(largePlan.planningBlockers.includes('MEASURE_LARGE_ROWS_OR_DESIGN_FIELD_CHUNKS'));
    assert.throws(() => planFreeD1Migration(tables.slice(1), usage), /INCOMPLETE_TABLE_SET/);
    assert.throws(() => planFreeD1Migration(tables.map(() => tables[0]), usage), /INCOMPLETE_TABLE_SET/);
    for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => planFreeD1Migration(mutate('record', { rows: value }), usage), /INVALID_COUNT/);
    assert.throws(() => planFreeD1Migration(tables, { rowsReadToday: 0, rowsWrittenToday: 0, workerRequestsToday: 0, accountStorageBytes: 0, wrongKey: 0 }), /INVALID_COUNT/);
    await assert.rejects(inspectFreeMigrationTable(readOnlySource, readOnlyTarget, 'record; DELETE FROM user', ['owner@example.invalid']), /UNKNOWN_TABLE/);
    await assert.rejects(inspectFreeMigrationTable(readOnlySource, readOnlyTarget, 'user', []), /OWNERS_REQUIRED/);
    await assert.rejects(inspectFreeMigrationTable(readOnlySource, readOnlyTarget, 'user', ['outsider@example.invalid']), /OWNER_MISMATCH/);
    await assert.rejects(inspectFreeMigrationTable({ transaction: async () => { throw Error('synthetic-private-url-and-token'); } }, readOnlyTarget, 'user', ['owner@example.invalid']), /^Error: PREFLIGHT_QUERY_FAILED$/);
    const badClose = { async transaction(mode) {
      const tx = await source.transaction(mode);
      return new Proxy(tx, { get(t, k) {
        if (k === 'close') return () => { t.close(); throw Error('synthetic-private-close-error'); };
        const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
      }});
    }};
    await assert.rejects(inspectFreeMigrationTable(badClose, readOnlyTarget, 'user', ['owner@example.invalid']), /^Error: PREFLIGHT_QUERY_FAILED$/);
    await source.execute("UPDATE user SET email_verified=0");
    await assert.rejects(inspectFreeMigrationTable(readOnlySource, readOnlyTarget, 'user', ['owner@example.invalid']), /OWNER_MISMATCH/);
    await source.execute("UPDATE user SET email_verified=1");
    await source.execute("UPDATE record SET ciphertext=x'0102'");
    await assert.rejects(inspectFreeMigrationTable(readOnlySource, readOnlyTarget, 'record', ['owner@example.invalid']), /UNSUPPORTED_SOURCE_VALUE/);
    await source.execute({ sql: 'UPDATE record SET ciphertext=?', args: [ciphertext] });
    await target.exec('ALTER TABLE record ADD COLUMN unexpected TEXT');
    await assert.rejects(inspectFreeMigrationTable(readOnlySource, readOnlyTarget, 'record', ['owner@example.invalid']), /DESTINATION_SCHEMA_MISMATCH/);
    await source.execute('ALTER TABLE record ADD COLUMN unexpected TEXT');
    await assert.rejects(inspectFreeMigrationTable(readOnlySource, readOnlyTarget, 'record', ['owner@example.invalid']), /SOURCE_SCHEMA_MISMATCH/);
    console.log('PASS free D1 preflight: 18 read-only table checks, aggregate-only output, owner/schema gates, UTF-8 bounds, quota/storage/large-row refusal, no activation receipt');
  } finally { source.close(); await mf.dispose(); fs.rmSync(temporary, { recursive: true, force: true }); fs.rmSync(output, { force: true }); }
};
if (require.main === module) module.exports().catch(e => { console.error(e); process.exitCode = 1; });
