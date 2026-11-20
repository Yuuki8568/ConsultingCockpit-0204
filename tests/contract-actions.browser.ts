/** Isolated synthetic-data browser check; no vault, customer data, or external requests. Run with bun. */
import { chromium } from '../packages/web/node_modules/@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dir, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'contract-actions-ui-'));
const entry = path.join(root, 'packages/web/tests', '.contract-actions-harness.tsx');
let server: ReturnType<typeof Bun.serve> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await writeFile(entry, `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ContractActionPanel} from '../src/web/components/contract-action-panel';
import {makeEmptyCase} from '../src/web/domain/logic/state';
import {APPROVED_TERMS_VERSION} from '../src/web/domain/data/approved-terms';
const c=makeEmptyCase('SYNTHETIC UI TEST');c.id='synthetic-stable-id';c.contractTemplateVersion=APPROVED_TERMS_VERSION;
const original=JSON.stringify(c);window.caseUnchanged=()=>original===JSON.stringify(c);
function App(){const [shown,setShown]=useState(true);const [evidence,setEvidence]=useState({});return <><button id="toggle" onClick={()=>setShown(!shown)}>切替</button><button id="destination">移動先</button>{shown&&<ContractActionPanel c={c} evidence={evidence} missingFacts={['通知先']} onEvidenceChange={setEvidence} onNavigate={()=>document.getElementById('destination').focus()}/>}</>};
createRoot(document.getElementById('root')).render(<App/>);`);
  const build = await Bun.build({entrypoints:[entry],outdir:temp,target:'browser',define:{'process.env.NODE_ENV':'"production"'}});
  assert.equal(build.success,true,build.logs.map(String).join('\n'));
  const js = await build.outputs[0].text();
  server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){return new URL(req.url).pathname==='/app.js'?new Response(js,{headers:{'Content-Type':'application/javascript'}}):new Response('<div id="root"></div><script type="module" src="/app.js"></script>',{headers:{'Content-Type':'text/html'}});}});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.port}`);
  const modal=page.getByRole('dialog',{name:'契約の確認が必要です'});
  await modal.waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'今は閉じる');
  await page.keyboard.press('Escape');
  await modal.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>(window as any).caseUnchanged()),true);
  await page.locator('#toggle').click();await page.locator('#toggle').click();
  assert.equal(await modal.isVisible(),false,'remount must not repeat automatic popup');
  await page.getByRole('button',{name:/要対応.*まとめて表示/}).click();
  await modal.waitFor({state:'visible'});
  await modal.getByRole('button',{name:'契約条件を確認'}).click();
  assert.equal(await page.locator('#destination').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.evaluate(()=>(window as any).caseUnchanged()),true);
  await page.reload();
  await page.getByRole('heading',{name:'契約アクション確認',exact:true}).waitFor();
  assert.equal(await modal.isVisible(),false,'sessionStorage dedupe survives reload');
  console.log('PASS: native dialog accessible name, autofocus, Escape, navigation focus, remount/reload dedupe, no case mutation');
} finally {
  await browser?.close();server?.stop();await rm(entry,{force:true});await rm(temp,{recursive:true,force:true});
}
