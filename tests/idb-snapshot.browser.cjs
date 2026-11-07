// Synthetic data in an isolated browser profile and loopback-only server.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('../packages/web/node_modules/@playwright/test');
const dep = require('node:module').createRequire(require.resolve('wrangler'));

module.exports = async function verifySnapshotBrowser() {
  const built = await dep('esbuild').build({ stdin: {
    contents: `import {idb,openDb,STORE_RECORDS} from './src/web/lib/store/idb';
      Object.assign(window,{idb,openDb,STORE_RECORDS,fixtureRow:(id)=>({id,type:'log',
        ciphertext:'synthetic',iv:'synthetic',updatedAtMs:1,deleted:false,seq:1,dirty:0})});
      await openDb();window.ready=true;`,
    resolveDir: path.resolve(__dirname, '../packages/web'), loader: 'ts',
  }, bundle: true, format: 'esm', platform: 'browser', write: false });
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(built.outputFiles[0].text); }
    else if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<script type="module" src="/fixture.js"></script>'); }
    else { res.statusCode = 404; res.end(); }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const context = await browser.newContext();
    const first = await context.newPage(), second = await context.newPage();
    await Promise.all([first, second].map(async page => { await page.goto(url); await page.waitForFunction(() => window.ready); }));
    const bounded = await first.evaluate(async () => {
      const { idb, fixtureRow } = window;
      await idb.clearAll();
      await idb.putRecords(Array.from({ length: 2048 }, (_, n) => ({
        ...fixtureRow(String(n).padStart(4, '0')), ciphertext: 'x'.repeat(16 * 1024),
      })));
      const before = await idb.allRecords();
      const getAll = IDBObjectStore.prototype.getAll, stringify = JSON.stringify;
      let compared = 0, largest = 0;
      IDBObjectStore.prototype.getAll = () => { throw Error('whole-store comparison'); };
      JSON.stringify = (value, ...args) => {
        if (Array.isArray(value) && value.some(row => row?.ciphertext)) throw Error('whole-vault JSON');
        const result = stringify(value, ...args);
        if (value?.ciphertext) { compared++; largest = Math.max(largest, result.length); }
        return result;
      };
      try {
        const update = { ...before[0], ciphertext: 'edited' };
        await idb.patchRecords(before, [update]);
        await idb.replaceRecords([update, ...before.slice(1)], [fixtureRow('restored')]);
      } finally { IDBObjectStore.prototype.getAll = getAll; JSON.stringify = stringify; }
      return { compared, largest, ids: (await idb.allRecords()).map(row => row.id) };
    });
    assert.equal(bounded.compared, 8192); assert.ok(bounded.largest < 17 * 1024);
    assert.deepEqual(bounded.ids, ['restored']);

    await first.evaluate(async () => {
      await window.idb.clearAll(); await window.idb.putRecords(['a', 'b'].map(window.fixtureRow));
      window.snapshot = await window.idb.allRecords();
    });
    await second.evaluate(async () => { await window.idb.putRecord({ ...window.fixtureRow('b'), hash: 'changed-by-other-tab' }); });
    const stale = await first.evaluate(async () => {
      const failures = [];
      for (const method of ['patchRecords', 'replaceRecords']) {
        try { await window.idb[method](window.snapshot, [window.fixtureRow('must-not-save')]); }
        catch { failures.push(method); }
      }
      return { failures, rows: await window.idb.allRecords() };
    });
    assert.equal(stale.failures.length, 2); assert.equal(stale.rows[1].hash, 'changed-by-other-tab');
    assert.deepEqual(stale.rows.map(row => row.id), ['a', 'b']);

    // Queue a different connection's writer while the full cursor is running.
    await first.evaluate(async () => {
      await window.idb.clearAll();
      await window.idb.putRecords(Array.from({ length: 3500 }, (_, n) => window.fixtureRow(String(n).padStart(4, '0'))));
      window.snapshot = await window.idb.allRecords();
    });
    let writer;
    await first.exposeFunction('notifyScan', () => {
      writer = second.evaluate(async () => {
        const db = await window.openDb(), t = db.transaction(window.STORE_RECORDS, 'readwrite');
        const requestedAt = Date.now(), store = t.objectStore(window.STORE_RECORDS);
        const request = store.get('0000'); let observed;
        request.onsuccess = () => { observed = request.result.ciphertext; store.put({ ...window.fixtureRow('0001'), ciphertext: 'second-writer' }); };
        await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onabort = () => reject(t.error); });
        return { observed, requestedAt };
      });
    });
    const finishedAt = await first.evaluate(async () => {
      const advance = IDBCursor.prototype.continue; let notified = false;
      IDBCursor.prototype.continue = function (...args) {
        if (!notified) { notified = true; void window.notifyScan(); }
        return advance.apply(this, args);
      };
      try {
        await window.idb.replaceRecords(window.snapshot, window.snapshot.map((row, i) => i ? row : { ...row, ciphertext: 'restored-before-second-writer' }));
        return Date.now();
      } finally { IDBCursor.prototype.continue = advance; }
    });
    assert.ok(writer, 'concurrent writer was queued');
    const concurrent = await writer;
    assert.ok(concurrent.requestedAt <= finishedAt, 'second writer started during the cursor scan');
    assert.equal(concurrent.observed, 'restored-before-second-writer');
    assert.equal(await first.evaluate(async () => (await window.idb.getRecord('0001')).ciphertext), 'second-writer');

    const rollback = await first.evaluate(async () => {
      await window.idb.clearAll(); await window.idb.putRecords(['a', 'b'].map(window.fixtureRow));
      const before = await window.idb.allRecords(), put = IDBObjectStore.prototype.put;
      let writes = 0, rejected = false;
      IDBObjectStore.prototype.put = function (...args) {
        if (++writes === 2) throw new DOMException('synthetic quota failure', 'QuotaExceededError');
        return put.apply(this, args);
      };
      try { await window.idb.replaceRecords(before, ['new-a', 'new-b'].map(window.fixtureRow)); }
      catch { rejected = true; }
      finally { IDBObjectStore.prototype.put = put; }
      return { rejected, unchanged: JSON.stringify(before) === JSON.stringify(await window.idb.allRecords()) };
    });
    assert.deepEqual(rollback, { rejected: true, unchanged: true });
    console.log(`PASS native IndexedDB: 2,048 records / 32 MiB; per-row comparison max ${bounded.largest} chars; two-tab conflict/serialization and atomic restore rollback`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
};
if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
