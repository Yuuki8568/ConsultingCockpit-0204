const {chromium}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 if(!process.env.REVIEW_HTML)throw Error('Set REVIEW_HTML to a completed precise transcription review.html');
 const root=path.resolve(__dirname,'..'),harness=path.join(root,'precise-handoff-harness.html');
 fs.writeFileSync(harness,`<!doctype html><div id="root"></div><script type="module">
 import React from 'react';import{createRoot}from'react-dom/client';
 import{TranscriptModal}from'/src/web/pages/case/recordings.tsx';
 import{VaultStore}from'/src/web/lib/store/vault-store.ts';
 import{deriveVaultKeys}from'/src/web/lib/crypto/vault-crypto.ts';
 import{makeEmptyVaultState,makeEmptyCase}from'/src/web/domain/logic/state.ts';
 import{applyTranscriptImport}from'/src/web/lib/transcription/review.ts';
 import{buildTranscriptPrompt}from'/src/web/domain/logic/recording.ts';
 import{idb}from'/src/web/lib/store/idb.ts';
 const store=new VaultStore();window.store=store;
 const keys=await deriveVaultKeys('integration-test-only',btoa('12345678901234567890123456789012'));
 if(location.search){await store.unlock(keys.vaultKey,keys.macKey);}else{const s=makeEmptyVaultState(),c=makeEmptyCase('精密取り込みテスト');c.id='test-case';c.recordings=[{id:'recording-1',name:'full-conversation.wav',transcript:'',transcriptAt:'',transcriptName:'',size:0}];s.cases=[c];s.currentCaseId=c.id;await store.initializeEmpty(keys.vaultKey,keys.macKey,s);}
 window.snapshot=()=>structuredClone(store.getState());window.rows=()=>idb.allRecords();window.prompt=()=>{const c=store.getState().cases[0];return buildTranscriptPrompt(c,c.recordings[0].transcript)};
 createRoot(document.getElementById('root')).render(React.createElement(TranscriptModal,{rec:store.getState().cases[0].recordings[0],onClose:()=>{},onSave:async(id,name,text,review)=>{await store.mutate(s=>applyTranscriptImport(s.cases[0],id,name,text,review),['case:test-case']);window.saved=true;}}));window.ready=true;
 </script>`);
 const server=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4183','--strictPort'],{cwd:root,stdio:'ignore'});let b;
 try{
 b=await chromium.launch({executablePath:process.env.BENCH_CHROMIUM,headless:true,args:['--no-sandbox']});const context=await b.newContext();
 await context.addInitScript(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}));
 const review=await context.newPage();await review.goto(require('node:url').pathToFileURL(process.env.REVIEW_HTML).href);
 const n=await review.getByRole('checkbox').count();if(!n)throw Error('No recognition segments');
 // Mechanical handoff test only: this is not a human verification of recognition accuracy.
 await review.locator('input[type=checkbox]').evaluateAll(nodes=>nodes.forEach(n=>{n.checked=true;n.dispatchEvent(new Event('change',{bubbles:true}));}));
 const dl=review.waitForEvent('download');await review.locator('#export').click();const download=await dl;const exported=await download.path();const bundle=JSON.parse(fs.readFileSync(exported));
 if(bundle.version!==2||bundle.recognition.mode!=='accurate')throw Error('Not a precise bundle');
 const page=await context.newPage();page.on('pageerror',e=>console.error(e));
 for(let i=0;i<60;i++){try{await page.goto('http://127.0.0.1:4183/precise-handoff-harness.html');break;}catch(e){if(i===59)throw e;await new Promise(r=>setTimeout(r,250));}}
 await page.waitForFunction(()=>window.ready);const before=await page.evaluate(()=>window.snapshot().cases[0].memo);
 await page.locator('input[type=file]').setInputFiles({name:'cockpit-reviewed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
 await page.getByText('元の録音名:',{exact:false}).waitFor();const save=page.getByRole('button',{name:'取り込む',exact:true});if(!await save.isDisabled())throw Error('Missing recording confirmation');
 await page.getByRole('checkbox').check();await save.click();await page.waitForFunction(()=>window.saved);
 const rows=await page.evaluate(()=>window.rows());const text=bundle.segments.map(s=>s.text).join('\n');if(JSON.stringify(rows).includes(text))throw Error('Plaintext persisted');
 await page.evaluate(()=>window.store.lock());await page.goto('http://127.0.0.1:4183/precise-handoff-harness.html?reload');await page.waitForFunction(()=>window.ready);
 const state=await page.evaluate(()=>window.snapshot());const rec=state.cases[0].recordings[0];
 if(rec.transcript!==text.trim()||rec.transcriptReview.originalText!==bundle.segments.map(s=>s.original).join('\n')||rec.transcriptReview.segments.length!==n)throw Error('Reload lost transcript/provenance');
 if(JSON.stringify(state.cases[0].memo)!==JSON.stringify(before))throw Error('Business fields overwritten');
 if(!(await page.evaluate(()=>window.prompt())).includes(text.trim()))throw Error('Case draft does not receive transcript');
 console.log(JSON.stringify({passed:true,segments:n,characters:text.length,model:rec.transcriptReview.recognition.model,encryptedPersistence:true,reload:true,originalPreserved:true,businessFieldsUnchanged:true}));
 }finally{if(b)await b.close();server.kill();fs.unlinkSync(harness);}
})().catch(e=>{console.error(e);process.exitCode=1});
