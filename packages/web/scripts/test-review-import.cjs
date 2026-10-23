const {chromium}=require('@playwright/test');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..');const harness=path.join(root,'review-harness.html');
 fs.writeFileSync(harness,`<!doctype html><div id="root"></div><script type="module">
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {TranscriptModal} from '/src/web/pages/case/recordings.tsx';
 createRoot(document.getElementById('root')).render(React.createElement(TranscriptModal,{rec:{id:'recording-1',name:'面談.mp4'},onClose:()=>{},onSave:(...args)=>{window.saved=args;}}));</script>`);
 const server=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4181','--strictPort'],{cwd:root,stdio:'ignore'});
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.BENCH_CHROMIUM,headless:true,args:['--no-sandbox']});
  const page=await browser.newPage();
  for(let i=0;i<60;i++){try{await page.goto('http://127.0.0.1:4181/review-harness.html');break;}catch(e){if(i===59)throw e;await new Promise(r=>setTimeout(r,250));}}
  const fixture={format:'cockpit-transcript-review',version:1,sourceName:'面談.mp4',reviewedAt:new Date().toISOString(),segments:[{start:0,end:2,original:'予算は未定です。',text:'予算はまだ未定です。',reviewed:true}]};
  const input=page.locator('input[type=file]');const save=page.getByRole('button',{name:'取り込む',exact:true});
  await input.setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await page.getByText('元の録音名:',{exact:false}).waitFor();
  if(!await save.isDisabled())throw Error('Import enabled before matching recording');
  await page.getByRole('checkbox').check();await save.click();
  const saved=await page.evaluate(()=>window.saved);
  if(saved[0]!=='recording-1'||saved[2]!==fixture.segments[0].text||saved[3].originalText!==fixture.segments[0].original)throw Error('Saved provenance mismatch');
  fixture.segments[0].reviewed=false;
  await input.setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await page.getByRole('alert').waitFor();
  if(!await save.isDisabled())throw Error('Invalid review was accepted');
  console.log('PASS: reviewed JSON imported; recording confirmation required; original retained; unreviewed JSON rejected');
 }finally{if(browser)await browser.close();server.kill();fs.unlinkSync(harness);}
})().catch(e=>{console.error(e);process.exitCode=1});
