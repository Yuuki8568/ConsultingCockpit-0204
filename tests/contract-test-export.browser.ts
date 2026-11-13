/** Isolated synthetic-data browser check; no vault, customer data, or external requests. Run with bun. */
import { chromium } from '../packages/web/node_modules/@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dir, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'contract-actions-ui-'));
const entry = path.join(root, 'packages/web/tests', '.contract-test-export-harness.tsx');
let server: ReturnType<typeof Bun.serve> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await writeFile(entry, `import React from 'react';
import {createRoot} from 'react-dom/client';
import {ContractTestExport} from '../src/web/components/contract-test-export';
import {makeEmptyCase} from '../src/web/domain/logic/state';
import {BUILT_IN_TEMPLATES} from '../src/web/domain/data/doc-templates';
const c=makeEmptyCase('');c.contractTemplateVersion=undefined;c.legalDocs.mainContract={status:'signed',signedAt:'2026-10-23',docNo:'SIGNED'};c.generatedDocs=[{id:'signed',docType:'mainContract',docNo:'SIGNED',content:'ORIGINAL',status:'signed',issuedAt:'2026-10-23'}];
const state={profile:{},cases:[c],docTemplates:BUILT_IN_TEMPLATES};const original=JSON.stringify(state);window.caseUnchanged=()=>original===JSON.stringify(state);
createRoot(document.getElementById('root')).render(<ContractTestExport c={c} state={state} sourceVersion="BROWSER-TEST"/>);`);
  const build = await Bun.build({entrypoints:[entry],outdir:temp,target:'browser',define:{'process.env.NODE_ENV':'"production"'}});
  assert.equal(build.success,true,build.logs.map(String).join('\n'));
  const js = await build.outputs[0].text();
  server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){return new URL(req.url).pathname==='/app.js'?new Response(js,{headers:{'Content-Type':'application/javascript'}}):new Response('<div id="root"></div><script type="module" src="/app.js"></script>',{headers:{'Content-Type':'text/html'}});}});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.port}`);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const button=page.getByRole('button',{name:'契約書一式をテスト出力'});
  await button.waitFor();assert.equal(await page.getByRole('combobox').inputValue(),'latest');
  let downloads=0;page.on('download',()=>downloads++);
  page.once('dialog',d=>d.dismiss());await button.click();await page.waitForTimeout(100);
  assert.equal(downloads,0);assert.equal(await page.evaluate(()=>(window as any).caseUnchanged()),true);
  for(const mode of ['latest','current','latest']){
    await page.getByRole('combobox').selectOption(mode);
    page.once('dialog',d=>{assert.ok(d.message().includes('契約利用不可'));void d.accept();});
    const downloaded=page.waitForEvent('download');await button.click();const file=await downloaded;
    assert.ok(file.suggestedFilename().startsWith('TEST_'));
    assert.equal(await page.evaluate(()=>(window as any).caseUnchanged()),true);
  }
  assert.equal(downloads,3);assert.deepEqual(errors,[]);
  console.log('PASS: actual production ContractTestExport component defaultlatest, cancelnoexport, repeatedlatest/current ZIPdownloads, signedstateunchanged, noJSerrors');

} finally {
  await browser?.close();server?.stop();await rm(entry,{force:true});await rm(temp,{recursive:true,force:true});
}
