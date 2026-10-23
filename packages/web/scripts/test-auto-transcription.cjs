// Real precise model + actual recording UI + encrypted store. No media in the repository.
const {chromium}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),harness=path.join(root,'auto-harness.html'),entry=path.join(root,'auto-harness.tsx');
 const origin='https://cockpit.yamashirogyomukaizen.com';
 const bridge=spawn(process.env.BRIDGE_PYTHON,[process.env.BRIDGE_SCRIPT,'--model',process.env.BRIDGE_MODEL,'--output',process.env.BRIDGE_OUTPUT,'--token-file',process.env.BRIDGE_TEST_KEY_FILE],{stdio:'ignore'});
 for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:8765/health');if(r.status===403)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 const key=fs.readFileSync(process.env.BRIDGE_TEST_KEY_FILE,'utf8').trim();
 fs.writeFileSync(harness,'<!doctype html><div id="root"></div><script type="module" src="/auto-harness.tsx"></script>');
 fs.writeFileSync(entry,`import React from 'react';import{createRoot}from'react-dom/client';
 import{CaseRecordings}from'/src/web/pages/case/recordings.tsx';
 import{VaultStore}from'/src/web/lib/store/vault-store.ts';
 import{deriveVaultKeys}from'/src/web/lib/crypto/vault-crypto.ts';
 import{makeEmptyVaultState,makeEmptyCase}from'/src/web/domain/logic/state.ts';
 import{idb}from'/src/web/lib/store/idb.ts';
 const store=new VaultStore();window.store=store;
 const keys=await deriveVaultKeys('integration-test-only',btoa('12345678901234567890123456789012'));
 if(location.search){await store.unlock(keys.vaultKey,keys.macKey);}else{const s=makeEmptyVaultState(),c=makeEmptyCase('auto-test');c.id='auto-case';c.recordings=[];s.cases=[c];s.currentCaseId=c.id;await store.initializeEmpty(keys.vaultKey,keys.macKey,s);}
 window.rows=()=>idb.allRecords();window.snapshot=()=>structuredClone(store.getState());
 createRoot(document.getElementById('root')).render(<CaseRecordings/>);window.ready=true;`);
 const server=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4184','--strictPort'],{cwd:root,stdio:'ignore'});let b;
 try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:4184/auto-harness.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 b=await chromium.launch({executablePath:process.env.BENCH_CHROMIUM,headless:true,args:['--no-sandbox']});const context=await b.newContext();
 try{await context.grantPermissions(['local-network-access'],{origin});}catch{}
 await context.addInitScript(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}));
 const page=await context.newPage();page.on('pageerror',e=>console.error(e));page.on('console',m=>{if(m.type()==='error')console.error(m.text());});page.on('requestfailed',r=>console.error('requestfailed',r.url(),r.failure()));
 const csp=fs.readFileSync(path.join(root,'src/security-headers.ts'),'utf8').match(/export const CSP = "([^"]+)"/)[1];
 await page.route(origin+'/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.includes('/hooks/use-vault'))return route.fulfill({contentType:'application/javascript',body:`import React from'/node_modules/.vite/deps/react.js';export function useVault(){const s=window.store;React.useSyncExternalStore(f=>s.subscribe(f),()=>s.getRevision());return{phase:s.getState()?'unlocked':'locked',state:s.getState()?{...s.getState()}:null,mutate:s.mutate.bind(s),saveMediaBlob:s.saveMediaBlob.bind(s),readMediaBlob:s.readMediaBlob.bind(s),deleteMediaBlob:s.deleteMediaBlob.bind(s)}}`});
  const response=await fetch('http://127.0.0.1:4184'+url.pathname+url.search);
  const headers=Object.fromEntries(response.headers);delete headers['content-length'];delete headers['content-encoding'];
  // Vite transform uses inline refresh preamble in dev; remove it, production has none.
  let body=await response.text();if(url.pathname.endsWith('.html')){body=body.replace(/<script type="module">[\s\S]*?<\/script>/g,'');headers['content-security-policy']=csp;}
  return route.fulfill({status:response.status,headers,body});
 });
 await page.addInitScript(()=>{window.__vite_plugin_react_preamble_installed__=true;window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>x=>x;});
 await page.goto(origin+'/auto-harness.html');await page.waitForFunction(()=>window.ready);
 const before=await page.evaluate(()=>window.snapshot().cases[0].memo);
 await page.getByLabel('端末内の接続キー').fill(key);await page.getByRole('button',{name:'端末内ツールに接続',exact:true}).click();await page.getByText('接続済み。',{exact:false}).waitFor({timeout:20000});
 for(const filename of [process.env.TEST_AUDIO,process.env.TEST_VIDEO]){
  const start=Date.now();await page.locator('input[type=file]').first().setInputFiles(filename);
  await page.waitForFunction(()=>window.snapshot().cases[0].recordings.at(-1)?.localRecognition,{timeout:180000});
  await page.waitForFunction(()=>!document.body.textContent.includes('取り込み中:'));
  const result=await page.evaluate(()=>{const r=window.snapshot().cases[0].recordings.at(-1);return{kind:r.localRecognition.sourceKind,segments:r.localRecognition.segments.length,characters:r.transcript.length,reviewed:!!r.transcriptReview}});
  if(result.reviewed||!result.characters)throw Error('Invalid automatic result');console.log(JSON.stringify({...result,wallSeconds:(Date.now()-start)/1000}));
 }
 const state=await page.evaluate(()=>window.snapshot());const rows=await page.evaluate(()=>window.rows());if(JSON.stringify(rows).includes(state.cases[0].recordings[0].transcript))throw Error('Plaintext persisted');
 if(JSON.stringify(before)!==JSON.stringify(state.cases[0].memo))throw Error('Business fields changed');
 await page.locator('input[type=file]').first().setInputFiles(process.env.TEST_AUDIO);
 await page.getByRole('status').filter({hasText:'精密文字起こし中'}).waitFor({timeout:20000});
 await page.getByRole('button',{name:'文字起こしを中止',exact:true}).click();
 await page.getByText('録音は登録済みです。文字起こし: 中止しました',{exact:false}).waitFor();
 if((await page.evaluate(()=>window.snapshot().cases[0].recordings.at(-1))).localRecognition)throw Error('Cancelled result saved');
 console.log(JSON.stringify({cancelled:true,registrationRetained:true}));
 await page.evaluate(()=>window.store.lock());await page.goto(origin+'/auto-harness.html?reload');await page.waitForFunction(()=>window.ready);
 const reloaded=await page.evaluate(()=>window.snapshot().cases[0].recordings);if(reloaded.length!==3||!reloaded.slice(0,2).every(r=>r.localRecognition&&r.transcript)||!!reloaded[2].localRecognition)throw Error('Reload lost result');
 console.log(JSON.stringify({passed:true,httpsOrigin:true,productionCsp:true,realMedia:true,actualRecordingUi:true,encryptedPersistence:true,reload:true,businessFieldsUnchanged:true}));
 }finally{if(b)await b.close();server.kill();bridge.kill('SIGINT');for(const f of[harness,entry])fs.unlinkSync(f);}
})().catch(e=>{console.error(e);process.exitCode=1});
