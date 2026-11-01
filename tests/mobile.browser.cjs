// Synthetic vault only. Exercises real responsive components and WebCrypto.
const {chromium}=require('../packages/web/node_modules/@playwright/test');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const cwd=path.resolve(__dirname,'../packages/web');
const html='mobile-test.html',entry='mobile-test.tsx';
(async()=>{
fs.writeFileSync(path.join(cwd,html),'<meta name="viewport" content="width=device-width, initial-scale=1"><script type="module" src="/mobile-test.tsx"></script>');
fs.writeFileSync(path.join(cwd,entry),`
import '/src/web/styles.css';
import React from 'react';import {createRoot} from 'react-dom/client';
import {Shell} from '/src/web/components/shell';import {PasskeyPanel} from '/src/web/components/passkey-panel';
import {Modal,Field} from '/src/web/components/kit';
import {makeEmptyVaultState,makeEmptyCase,makeEmptyLead} from '/src/web/domain/logic/state';
import {vaultStore as store} from '/src/web/lib/store/vault-store';
import {deriveVaultKeys,newSalt,seal} from '/src/web/lib/crypto/vault-crypto';
import {setupWriteSigning} from '/src/web/lib/write-signing';
const keys=await deriveVaultKeys('synthetic mobile test',newSalt(),100000);
const state=makeEmptyVaultState();state.cases=[makeEmptyCase('one'),makeEmptyCase('two')];state.cases[0].settings.companyName='テスト案件A';state.cases[1].settings.companyName='テスト案件B';state.currentCaseId=state.cases[0].id;
const lead=makeEmptyLead();lead.company='テストリード';state.leads=[lead];
await store.initializeEmpty(keys.vaultKey,keys.macKey,state);
Object.assign(window,{store,ready:true,keys,seal,setupWriteSigning});
function App(){const [settings,setSettings]=React.useState(false);return <Shell onOpenSettings={()=>setSettings(true)} onOpenActions={()=>{}} onNewCase={()=>{}} onNewLead={()=>{}}><Field label="営業メモ" value="" onChange={()=>{}}/><PasskeyPanel/><Modal title="設定" open={settings} onClose={()=>setSettings(false)}><PasskeyPanel/></Modal></Shell>};
createRoot(document.body.appendChild(document.createElement('div'))).render(<App/>);
`);
const server=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4189'],{cwd,stdio:'ignore'});let browser;
try{
for(let n=0;n<100;n++){try{if((await fetch('http://127.0.0.1:4189/'+html)).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
browser=await chromium.launch({args:['--no-sandbox']});
for(const width of [360,412,1280]){
 const page=await browser.newPage({viewport:{width,height:850},isMobile:width<600,hasTouch:width<600});
 await page.route('**/src/web/hooks/use-vault.tsx',r=>r.fulfill({contentType:'application/javascript',body:`import React from '/node_modules/.vite/deps/react.js';export function useVault(){const s=window.store;React.useSyncExternalStore(f=>s.subscribe(f),()=>s.getRevision());return {revision:s.getRevision(),phase:'unlocked',state:s.getState()?{...s.getState()}:null,mutate:s.mutate.bind(s),sync:{state:'idle',pending:0},syncNow:async()=>{},masked:false,setMasked:()=>{},lock:()=>{},lockWarning:false,secondsToLock:null}}`}));
 await page.route('**/src/web/lib/api.ts',r=>r.fulfill({contentType:'application/javascript',body:`export const client={writeKeys:{current:async()=>window.testIdentity,register:async()=>{throw Error('unexpected key rotation')}}};`}));
 await page.goto('http://127.0.0.1:4189/'+html);await page.getByLabel('営業メモ').waitFor();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('horizontal overflow '+width);
 await page.getByText('同期済み',{exact:true}).waitFor();
 if(width<600){
 const menu=page.getByRole('button',{name:'案件・リードの一覧を開く'});await menu.click();
 await page.getByRole('button',{name:/テスト案件B/}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-controls="cockpit-navigation"]').getAttribute('aria-expanded')==='false');
 await menu.click();await page.getByRole('button',{name:'設定・書類雛形・保全'}).click();
 await page.getByRole('heading',{name:'設定',exact:true}).waitFor();await page.getByRole('button',{name:'閉じる',exact:true}).click();
 const box=await menu.boundingBox();if(box.height<44)throw Error('small touch target');
 }
 await page.getByText('MacとAndroidで使う手順',{exact:true}).click();await page.getByText('AndroidのChromeで同じCockpitアカウントにログインします。',{exact:true}).waitFor();
 if(width===412){
 const result=await page.evaluate(async()=>{
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const privateJwk=await crypto.subtle.exportKey('jwk',pair.privateKey),publicJwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const encrypted=await window.seal(window.keys.vaultKey,privateJwk,'cockpit-write-private-v1');
 window.testIdentity={publicKey:JSON.stringify(publicJwk),privateCiphertext:encrypted.ciphertext,privateIv:encrypted.iv,generation:1,version:7};
 await window.setupWriteSigning(window.keys.vaultKey,1);await window.setupWriteSigning(window.keys.vaultKey,1);
 let oldGeneration=false,wrongKey=false;
 try{await window.setupWriteSigning(window.keys.vaultKey,2)}catch{oldGeneration=true}
 const bad=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 try{await window.setupWriteSigning(bad,1)}catch{wrongKey=true}
 return {oldGeneration,wrongKey,version:window.testIdentity.version};
 });
 if(!result.oldGeneration||!result.wrongKey||result.version!==7)throw Error('cross-device key protection');
 }
 console.log('PASS responsive navigation, sync label, settings, onboarding:',width);await page.close();
}
}finally{if(browser)await browser.close();server.kill();for(const f of [html,entry])fs.rmSync(path.join(cwd,f),{force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
