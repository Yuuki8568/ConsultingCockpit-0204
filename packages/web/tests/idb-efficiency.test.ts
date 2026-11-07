import { beforeEach, expect, test } from 'bun:test';
import 'fake-indexeddb/auto';
import { idb, type LocalRecord } from '../src/web/lib/store/idb';

const row = (id: string, dirty: 0 | 1 = 1): LocalRecord => ({
  id, type: 'log', ciphertext: 'synthetic-ciphertext', iv: 'synthetic-iv',
  updatedAtMs: 1, deleted: false, seq: 1, dirty,
});
const options = { maxRecords: 8, maxBytes: 4096, maxCiphertext: 1024 };
beforeEach(async () => { await idb.clearAll(); }, 30_000);

test('10k synced records are not cloned to count or select a small dirty batch', async () => {
  const rows = Array.from({ length: 10000 }, (_, i) => row(`log:${String(i).padStart(5, '0')}`, 0));
  await idb.putRecords([...rows, ...Array.from({ length: 47 }, (_, i) => row(`pending:${String(i).padStart(2, '0')}`))]);
  const getAll = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = function () { throw new Error('whole store read'); };
  try {
    expect(await idb.dirtyRecordCount()).toBe(47);
    expect((await idb.dirtyRecords()).length).toBe(47);
    let after: string | undefined;
    const seen: string[] = [];
    for (let n = 0; n < 6; n++) {
      const batch = await idb.dirtySyncBatch({ ...options, after });
      expect(batch.records.length).toBe(n === 5 ? 7 : 8);
      after = batch.nextAfter;
      seen.push(...batch.records.map(r => r.id));
      await idb.putRecords(batch.records.map(r => ({ ...r, dirty: 0 })));
      expect(batch.moreDirty).toBe(n < 5);
    }
    expect(new Set(seen).size).toBe(47);
    expect(await idb.dirtyRecordCount()).toBe(0);
  } finally { IDBObjectStore.prototype.getAll = getAll; }
}, 30_000);

test('bounded oversized scans make progress and keep later valid rows sendable', async () => {
  await idb.putRecords([
    ...Array.from({ length: 260 }, (_, i) => ({ ...row(`a:${String(i).padStart(3, '0')}`), ciphertext: 'x'.repeat(1025) })),
    row('z:valid'),
  ]);
  const first = await idb.dirtySyncBatch(options);
  expect(first.records.length).toBe(0);
  expect(first.oversizedIds.length).toBe(8);
  expect(first.nextAfter).toBe('a:127');
  expect(first.moreDirty).toBe(true);
  // An identical cursor after a failed network request returns the same batch.
  expect(await idb.dirtySyncBatch(options)).toEqual(first);
  const second = await idb.dirtySyncBatch({ ...options, after: first.nextAfter });
  expect(second.nextAfter).toBe('a:255');
  expect(second.moreDirty).toBe(true);
  const third = await idb.dirtySyncBatch({ ...options, after: second.nextAfter });
  expect(third.records.map(r => r.id)).toEqual(['z:valid']);
  expect(third.moreDirty).toBe(false);
  expect(third.nextAfter).toBeUndefined();
  // Read selection never mutates or discards the oversized originals.
  expect(await idb.dirtyRecordCount()).toBe(261);
}, 30_000);

test('batch byte boundary does not skip the first unsent row', async () => {
  await idb.putRecords(['a', 'b', 'c'].map(id => ({ ...row(id), ciphertext: 'x'.repeat(600) })));
  const batch = await idb.dirtySyncBatch({ ...options, maxBytes: 1700 });
  expect(batch.records.map(r => r.id)).toEqual(['a', 'b']);
  expect(batch.moreDirty).toBe(true);
  const rest = await idb.dirtySyncBatch({ ...options, maxBytes: 1700, after: batch.nextAfter });
  expect(rest.records.map(r => r.id)).toEqual(['c']);
  expect(rest.moreDirty).toBe(false);
}, 30_000);

test('a one-row edit writes one row while preserving whole-snapshot CAS', async () => {
  const rows = Array.from({ length: 2000 }, (_, i) => row(`log:${i}`, 0));
  await idb.putRecords(rows);
  const before = await idb.allRecords();
  const update = { ...before[10]!, ciphertext: 'edited-ciphertext', dirty: 1 as const };
  const put = IDBObjectStore.prototype.put;
  const clear = IDBObjectStore.prototype.clear;
  let puts = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) { puts++; return put.apply(this, args); };
  IDBObjectStore.prototype.clear = function () { throw new Error('normal edit must not clear records'); };
  try { await idb.patchRecords(before, [update]); }
  finally { IDBObjectStore.prototype.put = put; IDBObjectStore.prototype.clear = clear; }
  expect(puts).toBe(1);
  expect(await idb.getRecord(update.id)).toEqual(update);
  expect((await idb.allRecords()).length).toBe(2000);
  // A different row changed while encryption was running: fail without writing.
  const stale = await idb.allRecords();
  const concurrent = { ...stale[11]!, updatedAtMs: 77 };
  await idb.putRecord(concurrent);
  await expect(idb.patchRecords(stale, [{ ...update, ciphertext: 'must-not-save' }])).rejects.toThrow('別の処理');
  expect(await idb.getRecord(update.id)).toEqual(update);
  expect(await idb.getRecord(concurrent.id)).toEqual(concurrent);
  await idb.clearRecords();
  await expect(idb.patchRecords(stale, [update])).rejects.toThrow('別の処理');
  expect(await idb.allRecords()).toEqual([]);
}, 30_000);

test('an interrupted delta transaction rolls back every write', async () => {
  await idb.putRecords([row('first'), row('second')]);
  const before = await idb.allRecords();
  const put = IDBObjectStore.prototype.put;
  let writes = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    const request = put.apply(this, args);
    if (++writes === 2) this.transaction.abort();
    return request;
  };
  try {
    await expect(idb.patchRecords(before, before.map(r => ({ ...r, ciphertext: 'must-roll-back' })))).rejects.toThrow();
  } finally { IDBObjectStore.prototype.put = put; }
  expect(await idb.allRecords()).toEqual(before);
}, 30_000);
