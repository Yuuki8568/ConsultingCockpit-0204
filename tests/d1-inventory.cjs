// Synthetic libSQL and local D1 only. Inputs never come from a live database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const dep = require('node:module').createRequire(require.resolve('wrangler'));
const { createClient } = require('@libsql/client');
const { Miniflare, convertV4MiniflareOptions } = dep('miniflare');

module.exports = async function testInventory() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-inventory-'));
  const output = path.join(tmp, 'inventory.mjs');
  await dep('esbuild').build({ stdin: { contents: `
    export * from './security-ops/d1-inventory.ts';
    export * from './security-ops/d1-control-schema.ts';
    export { EXECUTION_CONTROL_SCHEMA } from './security-ops/d1-execution-schema.ts';
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: output });
  const { inspectSourceInventory, inspectMigrationInventory, inspectCatalog, COPY_CHECKPOINT_SCHEMA, COPY_VERIFICATION_SCHEMA,
    EXECUTION_CONTROL_SCHEMA } = await import(pathToFileURL(output));
  const source = createClient({ url: 'file:' + path.join(tmp, 'source.sqlite'), intMode: 'bigint' });
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-10-17',
    script: 'export default {fetch(){return new Response()}}', d1Databases: ['DEST'] }));
  try {
    const target = await runtime.getD1Database('DEST');
    const business = fs.readFileSync('cloudflare/d1/business-schema.sql', 'utf8');
    const assertion = fs.readFileSync('cloudflare/d1/schema.sql', 'utf8');
    const ddl = (business + assertion).replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
    await source.executeMultiple(business);
    await target.batch(ddl.map(s => target.prepare(s)));

    // Refuse customer data SELECTs even if an otherwise legitimate caller supplies such access.
    const metadataSource = { async transaction(mode) {
      assert.equal(mode, 'read');
      const tx = await source.transaction(mode);
      return { execute(statement) {
        assert.match(statement.sql, /^SELECT /);
        assert.match(statement.sql, /FROM main\.sqlite_schema /);
        return tx.execute(statement);
      }, commit: () => tx.commit(), rollback: () => tx.rollback(), close: () => tx.close() };
    }};
    const initial = await inspectSourceInventory(metadataSource);
    assert.deepEqual(initial, { businessTables: 18, businessObjects: 49, sourceProviderTables: 0, cutoverAllowed: false });
    await assert.rejects(inspectMigrationInventory(source, target), /^Error: INVENTORY_CONTROL_MISSING$/);
    await target.batch([COPY_CHECKPOINT_SCHEMA, COPY_VERIFICATION_SCHEMA, EXECUTION_CONTROL_SCHEMA].map(s => target.prepare(s)));
    const inspect = () => inspectMigrationInventory(source, target);
    const ready = await inspect();
    assert.equal(ready.destinationControlTables, 4);
    assert.equal(ready.destinationProviderTables, 1);
    assert.equal(ready.destinationEmpty, true);
    assert.equal(ready.cutoverAllowed, false);
    assert.ok(!JSON.stringify(ready).includes('cockpit_'));

    for (const [create, drop] of [
      ['CREATE TABLE private_extra(id INTEGER)', 'DROP TABLE private_extra'],
      ['CREATE TABLE _cf_private(id INTEGER)', 'DROP TABLE _cf_private'],
      ['CREATE VIEW private_extra AS SELECT 1', 'DROP VIEW private_extra'],
      ['CREATE INDEX private_extra ON user(name)', 'DROP INDEX private_extra'],
      ['CREATE TRIGGER private_extra AFTER INSERT ON user BEGIN SELECT 1; END', 'DROP TRIGGER private_extra'],
      ['CREATE TABLE cockpit_atomic_assertion (id TEXT PRIMARY KEY,ok INTEGER)', 'DROP TABLE cockpit_atomic_assertion'],
    ]) {
      await source.execute(create);
      await assert.rejects(inspectSourceInventory(metadataSource), /^Error: INVENTORY_SOURCE_MISMATCH$/);
      await source.execute(drop);
    }
    // D1 reserves _cf_ names. Exercise its real catalog shape in local libSQL.
    const provider = createClient({ url: 'file:' + path.join(tmp, 'provider.sqlite') });
    try {
      await provider.executeMultiple(business);
      const query = async (sql, args) => (await provider.execute({ sql, args })).rows;
      await provider.execute('CREATE TABLE _cf_KV (wrong TEXT)');
      await assert.rejects(inspectCatalog(query, 'destination'), /^Error: INVENTORY_DESTINATION_MISMATCH$/);
      await provider.execute('DROP TABLE _cf_KV');
      const providerDdl = "CREATE TABLE _cf_KV (\n        key TEXT PRIMARY KEY,\n        value BLOB\n      ) WITHOUT ROWID";
      await provider.execute(providerDdl);
      await provider.execute("INSERT INTO _cf_KV VALUES ('provider-private-key',x'41')");
      assert.equal((await inspectCatalog(query, 'destination')).providerTables, 1);
      await assert.rejects(inspectCatalog(query, 'source'), /^Error: INVENTORY_SOURCE_MISMATCH$/);
    } finally { provider.close(); }
    await target.prepare("CREATE INDEX extra_control_idx ON cockpit_execution_control(run_id)").run();
    await assert.rejects(inspect(), /^Error: INVENTORY_DESTINATION_MISMATCH$/);
    await target.prepare("DROP INDEX extra_control_idx").run();

    const legacy = [
      "CREATE TABLE cockpit_migration_run (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('copying','verified','failed')),row_count INTEGER NOT NULL,digest TEXT NOT NULL)",
      "CREATE TABLE cockpit_migration_row (run_id TEXT NOT NULL REFERENCES cockpit_migration_run(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,table_name TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,ordinal))",
      "CREATE TABLE cockpit_cutover_receipt(id TEXT PRIMARY KEY,status TEXT NOT NULL,at_ms INTEGER NOT NULL,manifest TEXT)",
    ];
    await target.batch(legacy.map(sql => target.prepare(sql)));
    await assert.rejects(inspect(), /^Error: INVENTORY_DESTINATION_MISMATCH$/);
    await target.prepare("CREATE INDEX cockpit_migration_owner ON cockpit_migration_run(created_at,user_id)").run();
    await assert.rejects(inspect(), /^Error: INVENTORY_DESTINATION_MISMATCH$/);
    await target.prepare("DROP INDEX cockpit_migration_owner").run();
    await target.prepare("CREATE INDEX cockpit_migration_owner ON cockpit_migration_run(user_id,created_at)").run();
    assert.equal((await inspect()).destinationControlTables, 7);
    await target.prepare("INSERT INTO cockpit_cutover_receipt VALUES ('private','failed',0,NULL)").run();
    await assert.rejects(inspect(), /^Error: INVENTORY_DESTINATION_OCCUPIED$/);
    assert.equal((await target.prepare('SELECT count(*) AS n FROM cockpit_cutover_receipt').first()).n, 1);
    await target.prepare('DELETE FROM cockpit_cutover_receipt').run();
    await target.prepare('DROP TABLE cockpit_copy_verification').run();
    await target.prepare(COPY_VERIFICATION_SCHEMA.replace("'matched'", "'Matched'")).run();
    await assert.rejects(inspect(), /^Error: INVENTORY_DESTINATION_MISMATCH$/);
    await target.prepare('DROP TABLE cockpit_copy_verification').run();
    await target.prepare(COPY_VERIFICATION_SCHEMA).run();
    await target.prepare("INSERT INTO security_counter VALUES ('private',0,1)").run();
    await assert.rejects(inspect(), /^Error: INVENTORY_DESTINATION_OCCUPIED$/);
    await target.prepare('DELETE FROM security_counter').run();

    await source.execute('ANALYZE');
    assert.ok((await inspectSourceInventory(metadataSource)).sourceProviderTables > 0);
    await source.executeMultiple(Array.from({length: 100}, (_, i) => 'CREATE TABLE extra_' + i + '(n INTEGER);').join('\n'));
    await assert.rejects(inspectSourceInventory(metadataSource), /^Error: INVENTORY_SOURCE_MISMATCH$/);
    await assert.rejects(inspectSourceInventory({ async transaction() { throw Error('synthetic-private-connection'); } }), /^Error: INVENTORY_QUERY_FAILED$/);
    console.log('PASS full schema inventory: metadata-only source, 49 objects, all reviewed controls/provider definitions, malformed and unknown objects, occupancy, no activation');
  } finally { source.close(); await runtime.dispose(); fs.rmSync(tmp, { recursive: true, force: true }); }
};
if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
