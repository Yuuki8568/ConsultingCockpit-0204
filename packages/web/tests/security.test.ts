import { beforeEach, afterEach, expect, mock, test } from 'bun:test';
import 'fake-indexeddb/auto';
import { idb } from '../src/web/lib/store/idb';
import { deriveVaultKey, deriveVaultKeys, seal, open, hmacHex, newSalt } from '../src/web/lib/crypto/vault-crypto';
import { recoverPortableBackup } from '../src/web/lib/export/backup-format';
import { makeEmptyVaultState, assertUniqueImportIds } from '../src/web/domain/logic/state';
import { sanitizeSheetCell, encodeCsv } from '../src/web/lib/export/xlsx';
let push: (...args: any[]) => Promise<any> = async () => { throw new Error('offline fixture'); };
mock.module('../src/web/lib/api', () => ({ client: { sync: { push: (...a: any[]) => push(...a) }, vault: { rekey: async () => ({}) } } }));
const { VaultStore } = await import('../src/web/lib/store/vault-store');
let held = false;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  onLine: false,
  locks: { request: async (_name: string, _options: unknown, callback: any) => {
    if (held) return callback(null);
    held = true;
    try { await callback({ name: 'test' }); } finally { held = false; }
  } }
} });
let store: InstanceType<typeof VaultStore>;
const salt = newSalt();
const keys = await deriveVaultKeys('dummy-strong-passphrase', salt, 100000);
beforeEach(async () => { await idb.clearAll(); held = false; store = new VaultStore(); });
afterEach(async () => { store.lock(); await store.flushPending(); await new Promise(r => setTimeout(r, 0)); });
async function initialized() { await store.initializeEmpty(keys.vaultKey, keys.macKey, makeEmptyVaultState()); }

test('AES compatibility and distinct MAC key material', async () => {
  const old = await deriveVaultKey('dummy-strong-passphrase', salt, 100000);
  const cipher = await seal(old, { dummy: 1 }, 'test');
  expect(await open(keys.vaultKey, cipher, 'test')).toEqual({ dummy: 1 });
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode('dummy-strong-passphrase'), 'PBKDF2', false, ['deriveKey']);
  const oldMac = await crypto.subtle.deriveKey({ name:'PBKDF2', salt: Uint8Array.from(atob(salt), c => c.charCodeAt(0)), iterations:100000, hash:'SHA-256' }, base, {name:'HMAC',hash:'SHA-256',length:256}, false, ['sign']);
  expect(await hmacHex(keys.macKey, 'dummy')).not.toBe(await hmacHex(oldMac, 'dummy'));
});
test('AAD rejects record substitution', async () => {
  const cipher = await seal(keys.vaultKey, { id:'a' }, 'cc4r|case|case:a');
  await expect(open(keys.vaultKey, cipher, 'cc4r|case|case:b', true)).rejects.toThrow();
});
test('corrupted row preserves all ciphertext and never creates deletion', async () => {
  await initialized(); store.lock(); await store.flushPending();
  const before = await idb.allRecords();
  before[0]!.ciphertext = 'broken'; await idb.putRecords(before);
  await expect(store.unlock(keys.vaultKey, keys.macKey)).rejects.toThrow();
  expect(await idb.allRecords()).toEqual(before); expect(store.getState()).toBeNull();
});
test('lock during delayed local read cannot repopulate state', async () => {
  await initialized(); store.lock(); await store.flushPending();
  const original = idb.allRecords; let release!: () => void;
  idb.allRecords = async () => { await new Promise<void>(r => release = r); return original(); };
  const pending = store.unlock(keys.vaultKey, keys.macKey);
  while (!release) await new Promise(r => setTimeout(r, 0));
  store.lock(); release();
  await expect(pending).rejects.toThrow(); idb.allRecords = original;
  expect(store.getState()).toBeNull(); expect(() => store.exportJson()).toThrow();
});
test('accepted edit saves after immediate lock', async () => {
  await initialized();
  const pending = store.mutate(s => { s.profile.name = 'dummy offline edit'; });
  store.lock(); expect(store.isUnlocked()).toBe(false); expect(() => store.exportJson()).toThrow();
  await pending; await store.flushPending();
  await store.unlock(keys.vaultKey, keys.macKey);
  expect(store.getState()?.profile.name).toBe('dummy offline edit');
});
test('failed atomic restore leaves original records and memory unchanged', async () => {
  await initialized(); const before = await idb.allRecords(); const oldState = store.getState();
  const original = idb.replaceRecords;
  idb.replaceRecords = async () => { throw new DOMException('quota fixture','QuotaExceededError'); };
  await expect(store.replaceState(makeEmptyVaultState())).rejects.toThrow();
  idb.replaceRecords = original;
  expect(await idb.allRecords()).toEqual(before); expect(store.getState()).toBe(oldState);
});
test('IndexedDB CAS rejects another writer without overwriting it', async () => {
  await initialized(); const before = await idb.allRecords();
  const changed = { ...before[0]!, updatedAtMs: 42 }; await idb.putRecord(changed);
  await expect(idb.replaceRecords(before, [])).rejects.toThrow();
  expect(await idb.getRecord(changed.id)).toEqual(changed);
});
test('second tab cannot acquire an unlocked vault', async () => {
  await initialized(); const second = new VaultStore();
  await expect(second.unlock(keys.vaultKey, keys.macKey)).rejects.toThrow('別タブ');
});
test('authenticated media manifest rejects missing first, middle, last and substituted chunks', async () => {
  await initialized(); const blob = new Blob([new Uint8Array(17 * 1024 * 1024).fill(7)]);
  await store.saveMediaBlob('dummy-media', blob);
  const original = await idb.mediaChunks('dummy-media');
  expect((await store.readMediaBlob('dummy-media', 'application/octet-stream')).size).toBe(blob.size);
  for (const index of [0,1,2]) {
    await idb.replaceMedia('dummy-media', original.filter(r => r.index !== index));
    await expect(store.readMediaBlob('dummy-media','application/octet-stream')).rejects.toThrow();
  }
  await idb.replaceMedia('dummy-media', original.map(r => r.index === 1 ? { ...r, data: original.find(x => x.index === 0)!.data } : r));
  await expect(store.readMediaBlob('dummy-media','application/octet-stream')).rejects.toThrow();
});
test('portable backup recovers offline with old phrase and rejects wrong phrase/tampering', async () => {
  const cipher = await seal(keys.vaultKey, { dummy:'backup' }, 'cc4-backup');
  const file = { app:'consulting-cockpit',kind:'encrypted-backup',format:2,exportedAt:'test',kdf:{algorithm:'PBKDF2-SHA256',salt,iterations:100000},...cipher };
  expect(JSON.parse(await recoverPortableBackup(JSON.stringify(file),'dummy-strong-passphrase'))).toEqual({dummy:'backup'});
  await expect(recoverPortableBackup(JSON.stringify(file),'wrong')).rejects.toThrow();
  await expect(recoverPortableBackup(JSON.stringify({...file,ciphertext:'AAAA'}),'dummy-strong-passphrase')).rejects.toThrow();
});
test('duplicate import IDs fail before storage', () => {
  expect(() => assertUniqueImportIds({ cases:[{id:'same'},{id:'same'}] })).toThrow();
  expect(() => assertUniqueImportIds({ cases:[{id:'a'}],leads:[{id:'a'}] })).not.toThrow();
});
test('CSV quotes CR, LF, quotes and commas, and distinguishes numbers from formula strings', () => {
  expect(encodeCsv(['name'], [['dummy\r=1+1'], ['a,b'], ['a"b'],['=1+1'],[-1]])).toBe('name\r\n"dummy\r=1+1"\r\n"a,b"\r\n"a""b"\r\n\'=1+1\r\n-1');
  expect(sanitizeSheetCell(' \t@SUM(1)')).toBe("' \t@SUM(1)");
});
test('lost rekey response preserves journal/media and new-key restart recovers audit and backup', async () => {
  await initialized(); await store.saveMediaBlob('rekey-media', new Blob(['dummy-media']));
  const originalRows = await idb.allRecords();
  await idb.putRecords(originalRows.map(r => ({...r,dirty:0 as const,seq:1})));
  const next = await deriveVaultKeys('new-dummy-phrase', newSalt(), 100000);
  const prepared = await store.prepareReencrypt(next.vaultKey, next.macKey);
  expect(prepared.records.length).toBeGreaterThan(0);
  await store.abortReencrypt(); await store.flushPending();
  expect(await idb.getMeta('rekeyJournal')).toBeTruthy();
  expect((await idb.mediaChunks('rekey-media')).length).toBe(2);
  store.setGeneration(2);
  await store.unlock(next.vaultKey,next.macKey);
  expect(await idb.getMeta('rekeyJournal')).toBeNull();
  expect(await (await store.readMediaBlob('rekey-media','text/plain')).text()).toBe('dummy-media');
  const audit = await store.sealAudit({dummy:'new audit'});
  expect(await open(next.vaultKey,audit)).toEqual({dummy:'new audit'});
  await expect(open(keys.vaultKey,audit)).rejects.toThrow();
});
test('partial corruption also blocks edits without creating tombstones', async () => {
  await initialized(); store.lock(); await store.flushPending();
  const original = await idb.allRecords();
  original[0]!.iv = 'invalid'; await idb.putRecords(original);
  await expect(store.unlock(keys.vaultKey,keys.macKey)).rejects.toThrow();
  await expect(store.mutate(s => { s.cases=[]; })).rejects.toThrow();
  expect(await idb.allRecords()).toEqual(original);
});

test('47 pending rows drain in bounded batches and survive retry and stale pull', async () => {
  await initialized();
  await idb.putRecords((await idb.allRecords()).map(r => ({ ...r, dirty: 0 as const })));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => 'test-device', setItem: () => {},
  } });
  const rows = Array.from({length:47}, (_, i) => ({
    id: `log:batch-${String(i).padStart(2,'0')}`, type:'log',
    ciphertext:`local-${i}`, iv:'local-iv', updatedAtMs:1,
    deleted:false, seq:0, dirty:1 as const,
  }));
  await idb.putRecords(rows);
  const sizes: number[] = [];
  let fail = false;
  let scheduled = 0;
  (store as any).online = true;
  (store as any).scheduleSync = () => { scheduled++; };
  push = async (input: any) => {
    sizes.push(input.records.length);
    if (fail) throw new Error('temporary failure');
    return { generation:1, accepted:input.records.map((r:any)=>r.id),
      acceptedVersions:Object.fromEntries(input.records.map((r:any)=>[r.id,10])),
      conflicts:[], changed: sizes.length === 1 ? [{...rows[46],ciphertext:'stale-server',seq:5,version:1}] : [],
      cursor:10, hasMore:false };
  };
  // Avoid decoding synthetic rows; this test exercises persistence and batching.
  (store as any).rebuildFromLocal = async () => {};
  await store.sync();
  expect((await idb.dirtyRecords()).length).toBe(27);
  expect((await idb.getRecord(rows[46]!.id))?.ciphertext).toBe('local-46');
  expect(scheduled).toBe(1);
  fail = true; await store.sync();
  expect((await idb.dirtyRecords()).length).toBe(27);
  fail = false; await store.sync(); await store.sync();
  expect(sizes).toEqual([20,20,20,7]);
  expect((await idb.dirtyRecords()).length).toBe(0);
  for (const row of rows) {
    const saved = await idb.getRecord(row.id);
    expect(saved?.ciphertext).toBe(row.ciphertext);
    expect(saved?.seq).toBe(10);
  }
});
