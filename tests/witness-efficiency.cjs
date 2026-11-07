// Synthetic audit history only. No remote database, account or business data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createClient } = require('@libsql/client');
const dep = require('node:module').createRequire(require.resolve('wrangler'));
const { build } = dep('esbuild');
const { Miniflare, convertV4MiniflareOptions } = dep('miniflare');
const modulePath = path.resolve('packages/web/tests/.witness-efficiency.mjs');

(async () => {
  await build({ stdin: { contents: `
    export {publishWitnesses} from './src/api/security/witness.ts';
    export {publishWitnessesD1} from './src/api/database/d1/witness.ts';
    export {databaseContext} from './src/api/database/index.ts';
    export {auditHash} from './src/api/security/audit.ts';
    export {drizzle} from 'drizzle-orm/libsql';
    export * as schema from './src/api/database/schema.ts';`,
    resolveDir: path.resolve('packages/web'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: modulePath });
  const { publishWitnesses, publishWitnessesD1, databaseContext, auditHash, drizzle, schema } = await import(pathToFileURL(modulePath));
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
    script: 'export default {fetch(){return new Response("synthetic")}}',
    compatibilityDate: '2026-10-17', d1Databases: ['DB'] }));
  const directory = fs.mkdtempSync('/tmp/cockpit-witness-efficiency-');
  const client = createClient({ url: `file:${directory}/test.db` });
  try {
    const d1 = await mf.getD1Database('DB');
    const sql = fs.readFileSync('cloudflare/d1/business-schema.sql', 'utf8');
    await client.executeMultiple(sql);
    await d1.batch(sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean).map(s => d1.prepare(s)));
    const insert = 'INSERT INTO audit_event(id,user_id,seq,action,at_ms,device_id,payload_ciphertext,payload_iv,prev_hash,hash,hash_version) VALUES (?,?,?,?,?,?,?,?,?,?,?)';
    const history = [];
    let previous = 'GENESIS';
    for (let seq = 1; seq <= 2001; seq++) {
      const row = { id: `event-${seq}`, userId: 'synthetic', seq, action: 'test', atMs: seq,
        deviceId: null, payloadCiphertext: seq === 2000 ? 'A'.repeat(750 * 1024) : null,
        payloadIv: null, prevHash: previous, hashVersion: 2 };
      const hash = await auditHash(row);
      history.push([row.id, row.userId, seq, row.action, seq, null, row.payloadCiphertext, null, previous, hash, 2]);
      previous = hash;
    }
    for (let offset = 0; offset < 2000; offset += 100) {
      const rows = history.slice(offset, Math.min(offset + 100, 2000));
      await client.batch(rows.map(args => ({ sql: insert, args })));
      await d1.batch(rows.map(args => d1.prepare(insert).bind(...args)));
    }
    const head = { seq: 2000, hash: history[1999][9] };
    await client.execute({ sql: 'INSERT INTO audit_head(user_id,seq,hash) VALUES (?,?,?)', args: ['synthetic', head.seq, head.hash] });
    await d1.prepare('INSERT INTO audit_head(user_id,seq,hash) VALUES (?,?,?)').bind('synthetic', head.seq, head.hash).run();

    for (const backend of ['libsql', 'd1']) {
      let bytes = 0, calls = 0, posts = 0, largestRead = 0, anchor = { ...head };
      let beforePayloadRead = null;
      const measure = results => { calls++; const size = Buffer.byteLength(JSON.stringify(results)); bytes += size; largestRead = Math.max(largestRead, size); return results; };
      const witness = { async fetch(request) {
        if (request.method === 'GET') return Response.json(anchor);
        const value = await request.json();
        assert.equal(value.previousSeq, anchor.seq); assert.equal(value.previousHash, anchor.hash);
        anchor = { seq: value.seq, hash: value.hash }; posts++;
        return Response.json({ ok: true });
      }};
      let publish, run;
      if (backend === 'libsql') {
        const measured = new Proxy(client, { get(target, property) {
          if (property === 'execute') return async (...args) => { if (beforePayloadRead && calls === 2) { const change = beforePayloadRead; beforePayloadRead = null; await change(); } const result = await target.execute(...args); measure(result.rows); return result; };
          if (property === 'batch') return async (...args) => { const result = await target.batch(...args); measure(result.map(r => r.rows)); return result; };
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        }});
        const db = drizzle(measured, { schema });
        publish = () => databaseContext.run({ db, witness }, publishWitnesses);
        run = (sql, ...args) => client.execute({ sql, args });
      } else {
        const originals = new WeakMap();
        const wrap = statement => {
          const proxy = new Proxy(statement, { get(target, property) {
            if (property === 'bind') return (...args) => wrap(target.bind(...args));
            if (property === 'raw') return async (...args) => { if (beforePayloadRead && calls === 2) { const change = beforePayloadRead; beforePayloadRead = null; await change(); } return measure(await target.raw(...args)); };
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          }});
          originals.set(proxy, statement); return proxy;
        };
        const measured = { prepare: sql => wrap(d1.prepare(sql)), async batch(statements) {
          const result = await d1.batch(statements.map(s => originals.get(s) ?? s));
          measure(result.map(r => r.results)); return result;
        }};
        publish = () => publishWitnessesD1(measured, witness);
        run = (sql, ...args) => d1.prepare(sql).bind(...args).run();
      }
      await publish();
      assert.equal(posts, 0); assert.ok(bytes < 1024, `${backend} no-op returned ${bytes} bytes`);
      assert.equal(calls, 2, 'head read plus compact anchor/page batch');
      const unchangedBytes = bytes;
      await run(insert, ...history[2000]);
      await run('UPDATE audit_head SET seq=2001,hash=?', history[2000][9]);
      bytes = 0; calls = 0;
      await publish();
      assert.equal(posts, 1); assert.equal(anchor.seq, 2001);
      assert.ok(bytes < 2048, `${backend} delta returned ${bytes} bytes`); assert.equal(calls, 3);
      await run("UPDATE audit_head SET hash=?", 'f'.repeat(64));
      await assert.rejects(publish(), /Audit head mismatch/);
      await run('UPDATE audit_head SET hash=?', history[2000][9]);
      await run('DELETE FROM audit_event WHERE seq=2001');
      await assert.rejects(publish(), /Audit checkpoint mismatch/);
      await run('UPDATE audit_head SET seq=2000,hash=?', history[1999][9]);
      await assert.rejects(publish(), /Audit tail missing/);
      assert.equal(posts, 1);
      console.log(`PASS ${backend} witness: 2000 historical events, 750 KiB anchor, ${unchangedBytes} bytes on no-op, bounded delta, no duplicate publication, head/anchor/tail rejection`);

      // More than the old 16 MiB gate, but individually valid encrypted events.
      // Every tick must make bounded progress and eventually witness the tail.
      await run('DELETE FROM audit_event'); await run('DELETE FROM audit_head');
      anchor = { seq: 0, hash: 'GENESIS' }; posts = 0;
      let previous = 'GENESIS';
      const largeHistory = [];
      for (let seq = 1; seq <= 25; seq++) {
        const row = { id: `large-${seq}`, userId: 'synthetic', seq, action: 'test', atMs: seq,
          deviceId: null, payloadCiphertext: 'A'.repeat(750 * 1024), payloadIv: null,
          prevHash: previous, hashVersion: 2 };
        const hash = await auditHash(row);
        const args = [row.id, row.userId, seq, row.action, seq, null, row.payloadCiphertext, null, previous, hash, 2];
        await run(insert, ...args); largeHistory.push(args); previous = hash;
      }
      await run('INSERT INTO audit_head(user_id,seq,hash) VALUES (?,?,?)', 'synthetic', 25, previous);
      bytes = 0; calls = 0; largestRead = 0;
      while (anchor.seq < 25) {
        const prior = anchor.seq; await publish();
        assert.ok(anchor.seq > prior); assert.ok(anchor.seq - prior <= 2);
        assert.equal(anchor.hash, largeHistory[anchor.seq - 1][9]);
        assert.ok(posts <= 13);
      }
      assert.equal(posts, 13); assert.ok(largestRead < 2 * 1024 * 1024);
      await publish(); assert.equal(posts, 13);

      // A row growing after the metadata query cannot trigger a large payload
      // read or advance the independent checkpoint.
      anchor = { seq: 0, hash: 'GENESIS' }; calls = 0;
      beforePayloadRead = () => run('UPDATE audit_event SET payload_ciphertext=? WHERE seq=1', 'B'.repeat(3 * 1024 * 1024));
      await assert.rejects(publish(), /Audit page changed/);
      assert.equal(beforePayloadRead, null); assert.equal(anchor.seq, 0); assert.equal(posts, 13);
      await run('UPDATE audit_event SET payload_ciphertext=? WHERE seq=1', largeHistory[0][6]);
      // Missing tail and changed contents must remain failures, even when the
      // normal page length is determined by bytes rather than a fixed count.
      anchor = { seq: 24, hash: largeHistory[23][9] };
      await run('DELETE FROM audit_event WHERE seq=25');
      await assert.rejects(publish(), /Audit tail missing/);
      await run(insert, ...largeHistory[24]);
      await run('UPDATE audit_event SET payload_ciphertext=? WHERE seq=25', 'tampered');
      await assert.rejects(publish(), /Audit chain mismatch/);
      assert.equal(posts, 13);
      console.log(`PASS ${backend} witness: 18 MiB backlog, 13 bounded checkpoints, payload growth race, missing tail and tamper refusal`);
    }
  } finally {
    client.close(); await mf.dispose(); fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(modulePath, { force: true }));
