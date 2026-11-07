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

test('large snapshot edit and restore avoid a second whole-store read and vault-sized JSON', async () => {
  const rows = Array.from({ length: 2048 }, (_, i) => ({
    ...row(`large:${String(i).padStart(4, '0')}`, 0), ciphertext: 'x'.repeat(16 * 1024),
  }));
  await idb.putRecords(rows);
  const before = await idb.allRecords();
  const getAll = IDBObjectStore.prototype.getAll, stringify = JSON.stringify;
  let compared = 0, largest = 0;
  IDBObjectStore.prototype.getAll = function () { throw new Error('whole-store comparison forbidden'); };
  JSON.stringify = ((value: unknown, replacer: any, space: any) => {
    if (Array.isArray(value) && value.some(r => r && typeof r === 'object' && 'ciphertext' in r))
      throw new Error('vault-sized comparison forbidden');
    const text = stringify(value, replacer, space);
    if (value && typeof value === 'object' && 'ciphertext' in value) {
      compared++; largest = Math.max(largest, text.length);
    }
    return text;
  }) as typeof JSON.stringify;
  const update = { ...before[0]!, ciphertext: 'edited', dirty: 1 as const };
  try {
    await idb.patchRecords(before, [update]);
    const patched = [update, ...before.slice(1)];
    await idb.replaceRecords(patched, [row('restored')]);
  } finally { IDBObjectStore.prototype.getAll = getAll; JSON.stringify = stringify; }
  expect(compared).toBe(2048 * 2 * 2);
  expect(largest).toBeLessThan(17 * 1024);
  expect(await idb.allRecords()).toEqual([row('restored')]);
}, 30_000);

test('both snapshot operations reject changes to every field of an untouched row', async () => {
  const modifications = [
    { type: 'case' }, { ciphertext: 'different' }, { iv: 'different' },
    { updatedAtMs: 2 }, { deleted: true }, { seq: 2 }, { dirty: 1 as const },
    { hash: 'different-keyed-fingerprint' }, { extra: 'unknown-field' },
  ];
  for (const operation of ['patchRecords', 'replaceRecords'] as const) {
    for (const modification of modifications) {
      await idb.clearRecords();
      await idb.putRecords([row('a', 0), row('b', 0)]);
      const before = await idb.allRecords();
      const concurrent = { ...before[1]!, ...modification };
      await idb.putRecord(concurrent);
      await expect(idb[operation](before, [{ ...before[0]!, ciphertext: 'must-not-save' }])).rejects.toThrow('別の処理');
      expect(await idb.allRecords()).toEqual([before[0]!, concurrent]);
    }
  }
}, 30_000);

test('snapshot CAS detects additions, deletions, same-count substitution and duplicate expected IDs', async () => {
  for (const operation of ['patchRecords', 'replaceRecords'] as const) {
    for (const change of ['addition', 'deletion', 'substitution', 'duplicate']) {
      await idb.clearRecords(); await idb.putRecords([row('a'), row('b')]);
      const before = await idb.allRecords();
      if (change === 'addition') await idb.putRecord(row('c'));
      if (change === 'deletion' || change === 'substitution') await idb.deleteRecord('b');
      if (change === 'substitution') await idb.putRecord(row('c'));
      const actual = await idb.allRecords();
      const expected = change === 'duplicate' ? [before[0]!, before[0]!] : before;
      await expect(idb[operation](expected, [row('replacement')])).rejects.toThrow('別の処理');
      expect(await idb.allRecords()).toEqual(actual);
    }
  }
}, 30_000);

test('interrupted cursor scanning writes nothing and a failed restore rolls back clear and puts', async () => {
  await idb.putRecords([row('a'), row('b'), row('c')]);
  const before = await idb.allRecords();
  const advance = IDBCursor.prototype.continue;
  let scanned = 0;
  IDBCursor.prototype.continue = function (...args: Parameters<typeof advance>) {
    if (++scanned === 2) { (this.source as IDBObjectStore).transaction.abort(); return; }
    return advance.apply(this, args);
  };
  try { await expect(idb.replaceRecords(before, [row('replacement')])).rejects.toThrow(); }
  finally { IDBCursor.prototype.continue = advance; }
  expect(await idb.allRecords()).toEqual(before);
  const put = IDBObjectStore.prototype.put;
  let writes = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    if (++writes === 2) throw new DOMException('synthetic quota failure', 'QuotaExceededError');
    return put.apply(this, args);
  };
  try { await expect(idb.replaceRecords(before, [row('replacement-a'), row('replacement-b')])).rejects.toThrow(); }
  finally { IDBObjectStore.prototype.put = put; }
  expect(writes).toBe(2);
  expect(await idb.allRecords()).toEqual(before);
}, 30_000);

test('expected scalar values are pinned before awaiting DB and empty snapshots remain atomic', async () => {
  await idb.putRecords([row('a')]);
  const before = await idb.allRecords();
  const after = { ...before[0]!, ciphertext: 'saved' };
  const pending = idb.patchRecords(before, [after]);
  before[0]!.ciphertext = 'caller-mutated-after-start';
  await pending;
  expect(await idb.allRecords()).toEqual([after]);
  await idb.replaceRecords([after], []);
  await idb.replaceRecords([], [row('new')]);
  expect(await idb.allRecords()).toEqual([row('new')]);
});
