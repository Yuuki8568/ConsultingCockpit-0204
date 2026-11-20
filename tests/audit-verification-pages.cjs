// Real local libSQL and D1-compatible SQL; synthetic records only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createClient } = require('@libsql/client');
const dep = require('node:module').createRequire(require.resolve('wrangler'));
const { build } = dep('esbuild');
const { Miniflare, convertV4MiniflareOptions } = dep('miniflare');

module.exports = async function verifyAuditRuntime() {
  const bundle = path.resolve('packages/web/tests/.audit-verification-pages.mjs');
  const dir = fs.mkdtempSync('/tmp/cockpit-audit-pages-');
  let mf, client;
  try {
    await build({ stdin: { contents: `
      export {auditReader,verifyAuditPage} from './src/api/security/audit-verification.ts';
      export {auditHash} from './src/api/security/audit.ts';
      export {drizzle as libsql} from 'drizzle-orm/libsql';
      export {drizzle as d1drizzle} from 'drizzle-orm/d1';
      export * as schema from './src/api/database/schema.ts';`,
      resolveDir: path.resolve('packages/web'), loader: 'ts' },
      bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle });
    const { auditReader, verifyAuditPage, auditHash, libsql, d1drizzle, schema } = await import(pathToFileURL(bundle));
    mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
      script: 'export default {fetch(){return new Response("synthetic")}}',
      compatibilityDate: '2026-10-17', d1Databases: ['DB'] }));
    const d1 = await mf.getD1Database('DB');
    client = createClient({ url: `file:${dir}/test.db` });
    const schemaSql = fs.readFileSync('cloudflare/d1/business-schema.sql', 'utf8');
    await client.executeMultiple(schemaSql);
    await d1.batch(schemaSql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean).map(s => d1.prepare(s)));
    const insert = 'INSERT INTO audit_event(id,user_id,seq,action,at_ms,device_id,payload_ciphertext,payload_iv,prev_hash,hash,hash_version) VALUES (?,?,?,?,?,?,?,?,?,?,?)';
    for (const backend of ['libsql', 'd1']) {
      const run = backend === 'libsql' ? (sql, ...args) => client.execute({ sql, args }) :
        (sql, ...args) => d1.prepare(sql).bind(...args).run();
      const database = backend === 'libsql' ? libsql(client, { schema }) : d1drizzle(d1, { schema });
      let previous = 'GENESIS';
      const history = [];
      for (let seq = 1; seq <= 225; seq++) {
        const row = { id: 'row-' + seq, userId: 'owner', seq, action: 'synthetic', atMs: seq,
          deviceId: null, payloadCiphertext: seq > 200 ? 'A'.repeat(750 * 1024) : null,
          payloadIv: null, prevHash: previous, hashVersion: 2 };
        const hash = await auditHash(row);
        await run(insert, row.id, row.userId, seq, row.action, seq, null, row.payloadCiphertext, null, previous, hash, 2);
        history.push({ ...row, hash }); previous = hash;
      }
      await run('INSERT INTO audit_head(user_id,seq,hash) VALUES (?,?,?)', 'owner', 225, previous);
      await run(insert, 'other-private-id', 'other', 1, 'synthetic', 1, null, 'private-other-ciphertext', null, 'GENESIS', 'f'.repeat(64), 2);
      const reader = auditReader(database, 'owner');
      let payloadRows = 0, largest = 0;
      const rawRead = reader.rows;
      reader.rows = async (...args) => {
        const rows = await rawRead(...args);
        payloadRows += rows.length;
        largest = Math.max(largest, Buffer.byteLength(JSON.stringify(rows)));
        assert.ok(rows.length <= 100);
        assert.ok(rows.every(row => row.userId === 'owner'));
        return rows;
      };
      const options = { reader, userId: 'owner', sessionId: 'session', backend,
        secret: 'synthetic-local-audit-secret-not-for-production-0000',
        witness: async () => ({ seq: 225, hash: previous }) };
      let cursor, pages = 0, result;
      do {
        result = await verifyAuditPage({ ...options, cursor }); pages++;
        if (!result.complete) { assert.equal(result.ok, false); assert.ok(result.cursor); }
        cursor = result.cursor;
      } while (cursor && pages < 20);
      assert.equal(result.ok, true); assert.equal(result.checked, 225); assert.equal(pages, 15);
      assert.equal(payloadRows, 225); assert.ok(largest < 2 * 1024 * 1024);
      assert.deepEqual(await auditReader(database, "owner' OR 1=1 --").metadata(0, 1000), []);

      // Metadata queries must not transfer an attacker-inflated hash either.
      await run("UPDATE audit_event SET hash=? WHERE user_id='owner' AND seq=225", 'f'.repeat(3 * 1024 * 1024));
      await run("UPDATE audit_head SET hash=? WHERE user_id='owner'", 'f'.repeat(3 * 1024 * 1024));
      assert.equal((await reader.head()).hash.length, 65);
      assert.equal((await reader.latest()).hash.length, 65);
      assert.equal((await reader.hashAt(225)).length, 65);
      assert.equal((await reader.metadata(224, 225))[0].hash.length, 65);
      assert.equal((await verifyAuditPage(options)).ok, false);
      await run("UPDATE audit_event SET hash=? WHERE user_id='owner' AND seq=225", previous);
      await run("UPDATE audit_head SET hash=? WHERE user_id='owner'", previous);

      // Recheck byte limits at payload-read time, including non-payload text.
      for (const column of ['payload_ciphertext', 'action']) {
        const raceReader = auditReader(database, 'owner');
        const read = raceReader.rows;
        let returned;
        raceReader.rows = async (...args) => {
          await run(`UPDATE audit_event SET ${column}=? WHERE user_id='owner' AND seq=1`, 'B'.repeat(3 * 1024 * 1024));
          const rows = await read(...args); returned = rows.length; return rows;
        };
        const bad = await verifyAuditPage({ ...options, reader: raceReader });
        assert.equal(bad.ok, false); assert.equal(bad.cursor, undefined); assert.equal(returned, 0);
        await run(`UPDATE audit_event SET ${column}=? WHERE user_id='owner' AND seq=1`, column === 'action' ? 'synthetic' : null);
      }
      const first = await verifyAuditPage(options);
      await run("DELETE FROM audit_event WHERE user_id='owner' AND seq=150");
      const missing = await verifyAuditPage({ ...options, cursor: first.cursor });
      assert.equal(missing.ok, false); assert.equal(missing.cursor, undefined);
      console.log(`PASS ${backend} full audit: 225 records / >18 MiB, 15 bounded pages, tenant isolation, payload/metadata growth races and deletion refusal`);
    }
  } finally {
    client?.close(); if (mf) await mf.dispose();
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(bundle, { force: true });
  }
};
if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
