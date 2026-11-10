// Real components; synthetic vault, mocked remote authentication and isolated Chrome profile.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const { chromium } = require('../packages/web/node_modules/@playwright/test');
module.exports = async function verifyFreeFollowup() {
  const cwd = path.resolve(__dirname, '../packages/web');
  const html = 'followup-test.html', entry = 'followup-test.tsx';
  fs.writeFileSync(path.join(cwd, html), '<meta name="viewport" content="width=device-width, initial-scale=1"><script type="module" src="/followup-test.tsx"></script>');
  fs.writeFileSync(path.join(cwd, entry), `
import '/src/web/styles.css';
import React from 'react'; import {createRoot} from 'react-dom/client';
import Index from '/src/web/pages/index';
import {BackupBadge} from '/src/web/components/automatic-backup';
import {vaultStore as store} from '/src/web/lib/store/vault-store';
import {idb} from '/src/web/lib/store/idb';
import {deriveVaultKeys,newSalt} from '/src/web/lib/crypto/vault-crypto';
import {makeEmptyVaultState,makeEmptyCase} from '/src/web/domain/logic/state';
const keys=await deriveVaultKeys('synthetic followup only',newSalt(),100000);
const state=makeEmptyVaultState(); state.cases=[makeEmptyCase('synthetic')]; state.currentCaseId=state.cases[0].id;
Object.assign(store,{online:false}); await store.initializeEmpty(keys.vaultKey,keys.macKey,state);
const fixture={calls:0,active:0,maxActive:0,gates:[],markers:[],syncCalls:0,registerCalls:0,allowAuthentication:false,syncFailure:false};
store.getState().docTemplates.synthetic='x'.repeat(8*1024*1024);
store.getState().docTemplates.marker='original';
store.backupFingerprint=async snapshot=>{fixture.calls++;fixture.active++;fixture.maxActive=Math.max(fixture.maxActive,fixture.active);fixture.markers.push(snapshot.docTemplates.marker);try{return await new Promise((resolve,reject)=>fixture.gates.push({resolve,reject}));}finally{fixture.active--;}};
store.sync=async()=>{fixture.syncCalls++;store.setStatus(fixture.syncFailure?{state:'error',lastError:'synthetic network failure',pending:0}:{state:'idle',lastError:null,pending:0});};
Object.assign(window,{fixture,store,idb,keys});
window.setConfig=async config=>{await idb.setMeta('automatic-backup-v1',config);window.dispatchEvent(new Event('cockpit-backup'));};
window.editMarker=value=>{store.getState().docTemplates.marker=value;store.emit();};
const root=createRoot(document.body.appendChild(document.createElement('div')));
window.renderBadge=()=>root.render(<BackupBadge onOpenSettings={()=>{}}/>);
window.renderApp=()=>root.render(<Index/>);
window.renderBadge(); window.ready=true;
`);
  const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4193'], { cwd, stdio: 'ignore' });
  let browser;
  try {
    for (let n = 0; n < 100; n++) { try { if ((await fetch('http://127.0.0.1:4193/' + html)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/src/web/hooks/use-vault.tsx', route => route.fulfill({ contentType: 'application/javascript', body: `
import React from '/node_modules/.vite/deps/react.js';
export function useVault(){const s=window.store;React.useSyncExternalStore(f=>s.subscribe(f),()=>s.getRevision());const sync=React.useSyncExternalStore(f=>s.subscribeStatus(f),()=>s.getStatus());return {phase:s.isUnlocked()?'unlocked':'locked',revision:s.getRevision(),state:s.getState(),sync,mutate:s.mutate.bind(s),syncNow:s.sync.bind(s),masked:false,setMasked:()=>{},lock:s.lock.bind(s),lockWarning:false,secondsToLock:null,audit:()=>{}};}
export function useVaultState(){return useVault().state;}` }));
    await page.route('**/src/web/lib/step-up.ts', route => route.fulfill({ contentType: 'application/javascript', body: `export async function authorize(action){if(action!=='device:register'||!window.fixture.allowAuthentication)throw Error('synthetic authentication cancelled');return 'synthetic-approved-ticket';}` }));
    await page.route('**/src/web/lib/api.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
export const client={vault:{status:async()=>({exists:true,storageBackend:'libsql'})},devices:{register:async input=>{if(input.authorization!=='synthetic-approved-ticket')throw Error('missing authentication');window.fixture.registerCalls++;return {ok:true};}},passkeys:{},writeKeys:{}};export const orpc={};` }));
    await page.goto('http://127.0.0.1:4193/' + html);
    const button = label => page.getByRole('button', { name: label, exact: true });
    await button('バックアップ未設定：保存先を設定').waitFor();
    for (let i = 0; i < 3; i++) { await page.evaluate(i => window.editMarker('unset-' + i), i); await page.waitForTimeout(25); }
    assert.equal(await page.evaluate(() => fixture.calls), 0, 'unconfigured vault must not be cloned/hashed');
    await page.evaluate(() => window.setConfig({ enabled: true, directory: { name: 'synthetic' } }));
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => fixture.calls), 0, 'no saved snapshot to compare');
    await page.evaluate(() => window.setConfig({ enabled: true, directory: { name: 'synthetic' }, snapshotHash: 'saved' }));
    await page.waitForFunction(() => fixture.calls === 1);
    for (let i = 0; i < 12; i++) { await page.evaluate(i => window.editMarker('edit-' + i), i); await page.waitForTimeout(25); }
    assert.equal(await page.evaluate(() => fixture.calls), 1, 'edits must not create concurrent snapshots');
    await page.evaluate(() => fixture.gates.shift().resolve('saved'));
    await page.waitForFunction(() => fixture.calls === 2);
    await button('未バックアップ：今すぐバックアップ').waitFor();
    assert.deepEqual(await page.evaluate(() => ({ max: fixture.maxActive, last: fixture.markers.at(-1) })), { max: 1, last: 'edit-11' });
    await page.evaluate(() => fixture.gates.shift().resolve('latest'));
    await button('未バックアップ：今すぐバックアップ').waitFor();
    await page.evaluate(() => window.setConfig({ enabled: true, directory: { name: 'synthetic' }, snapshotHash: 'latest' }));
    await page.waitForFunction(() => fixture.calls === 3);
    await page.evaluate(() => fixture.gates.shift().resolve('latest'));
    await button('バックアップ済み：今すぐバックアップ').waitFor();

    // Failure releases the queue; a newer edit is still checked, never marked saved by the old result.
    await page.evaluate(() => window.editMarker('failure'));
    await page.waitForFunction(() => fixture.calls === 4);
    await page.evaluate(() => window.editMarker('after-failure')); await page.waitForTimeout(25);
    await page.evaluate(() => fixture.gates.shift().reject(Error('synthetic digest failure')));
    await page.waitForFunction(() => fixture.calls === 5);
    await page.evaluate(() => fixture.gates.shift().resolve('changed'));
    await button('未バックアップ：今すぐバックアップ').waitFor();
    await page.evaluate(() => window.editMarker('before-lock'));
    await page.waitForFunction(() => fixture.calls === 6);
    await page.evaluate(() => { window.editMarker('queued-before-lock'); store.lock(); });
    await page.waitForTimeout(25);
    await page.evaluate(() => fixture.gates.shift().resolve('latest'));
    await page.waitForFunction(() => fixture.active === 0);
    assert.equal(await page.getByRole('button').count(), 0, 'late result must not restore a locked badge');
    assert.equal(await page.evaluate(() => fixture.calls), 6, 'locking cancels the queued snapshot');
    console.log('PASS 8 MiB backup status: no unconfigured copies, max one active snapshot, latest edit, failure recovery, lock cancellation');

    await page.evaluate(async () => { await store.unlock(keys.vaultKey, keys.macKey); await window.setConfig(undefined); store.setStatus({state:'error',lastError:'Forbidden',pending:0}); window.renderApp(); });
    for (const width of [360, 412, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await button('同期・端末の設定を開く').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await button('同期・端末の設定を開く').click();
      await page.getByRole('heading', { name: 'パスキーで重要操作を保護' }).waitFor();
      await button('閉じる').click();
    }
    await button('同期・端末の設定を開く').click();
    await button('本人確認してこの端末を登録').click();
    await page.getByText('synthetic authentication cancelled', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => fixture.registerCalls), 0);
    assert.equal(await page.evaluate(() => fixture.syncCalls), 0);
    await page.evaluate(() => { fixture.allowAuthentication=true; fixture.syncFailure=true; });
    await button('本人確認してこの端末を登録').click();
    await page.getByText('端末の本人確認が完了しました。画面上部の同期状態を確認してください。', { exact: true }).waitFor();
    await button('同期エラー').waitFor();
    await page.evaluate(() => { fixture.syncFailure=false; });
    await button('本人確認してこの端末を登録').click();
    await button('同期済み').waitFor();
    assert.deepEqual(await page.evaluate(() => [fixture.registerCalls, fixture.syncCalls]), [2, 2]);
    await button('閉じる').click();
    await button('設定・書類雛形・保全').click();
    await page.getByRole('heading', { name: '基本', exact: true }).waitFor();
    await button('閉じる').click();
    await button('バックアップ未設定：保存先を設定').click();
    await page.getByRole('heading', { name: '保存容量と増え方' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS real settings navigation at 360/412/1280px; cancelled authentication sends nothing; authenticated retry preserves sync failures and succeeds without reload');
  } finally {
    if (browser) await browser.close(); server.kill();
    for (const f of [html, entry]) fs.rmSync(path.join(cwd, f), { force: true });
  }
};
