import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractTestBundle, TEST_NOTICE, TEST_DOC_TYPES } from '../packages/web/src/web/lib/export/contract-test';
import { APPROVED_TERMS_VERSION, APPROVED_TERMS_TEMPLATES } from '../packages/web/src/web/domain/data/approved-terms';
import { savedDocumentsForExport } from '../packages/web/src/web/domain/logic/docs';
import type { CaseRecord, VaultState } from '../packages/web/src/web/domain/types';
export function blankFixture() {
 const c={id:'test',settings:{},execution:{deliverables:[]},estimate:{},legalDocs:{},generatedDocs:[],contractTemplateVersion:APPROVED_TERMS_VERSION} as unknown as CaseRecord;
 return {c,state:{profile:{},cases:[c],docTemplates:{}} as unknown as VaultState};
}
test('blank fields produce all nine test copies, warnings, metadata; formal remains blocked',()=>{
 const {c,state}=blankFixture();const before=JSON.stringify(state);
 assert.throws(()=>savedDocumentsForExport(c,TEST_DOC_TYPES));
 const b=buildContractTestBundle(c,state,'source-sha',new Date('2026-10-24T01:00:00Z'));
 assert.equal(b.entries.length,10);assert.ok(b.fileName.startsWith('TEST_'));
 for(const e of b.entries){assert.ok(e.name.startsWith('TEST_'));assert.ok(String(e.content).includes(TEST_NOTICE));assert.ok(String(e.content).includes('source-sha'));assert.ok(String(e.content).includes(APPROVED_TERMS_VERSION));}
 assert.equal(b.entries.filter(e=>e.name.endsWith('.doc')).length,9);
 assert.ok(String(b.entries[0].content).includes('○'));assert.ok(String(b.entries[0].content).includes('要確認'));
 assert.equal(JSON.stringify(state),before);assert.throws(()=>savedDocumentsForExport(c,TEST_DOC_TYPES));
});
test('signed history, selection, confirmations and numbers stay byte-identical',()=>{
 const {c,state}=blankFixture();c.legalDocs.mainContract={status:'signed',signedAt:'2026-10-23',docNo:'CT-existing'};
 c.generatedDocs=[{id:'locked',docType:'mainContract',docNo:'CT-existing',issuedAt:'2026-10-23',content:'SIGNED ORIGINAL',status:'signed'}];
 const before=JSON.stringify(state);const b=buildContractTestBundle(c,state,'sha');
 assert.equal(JSON.stringify(state),before);assert.ok(!b.entries.some(e=>String(e.content).includes('SIGNED ORIGINAL')));
});
test('no automatic version upgrade or fallback for missing selected templates',()=>{
 const {c,state}=blankFixture();delete c.contractTemplateVersion;
 assert.throws(()=>buildContractTestBundle(c,state,'sha'));
 state.docTemplates={...APPROVED_TERMS_TEMPLATES};
 const b=buildContractTestBundle(c,state,'sha');assert.ok(String(b.entries[0].content).includes('未選択'));assert.equal(c.contractTemplateVersion,undefined);
});
test('explicit latest TEST choice on legacy signed case never upgrades stored case',()=>{
 const {c,state}=blankFixture();delete c.contractTemplateVersion;
 c.legalDocs.mainContract={status:'signed',signedAt:'2026-10-23',docNo:'CT-existing'};
 c.generatedDocs=[{id:'locked',docType:'mainContract',docNo:'CT-existing',issuedAt:'2026-10-23',content:'SIGNED ORIGINAL',status:'signed'}];
 c.contractFacts={informationManagement:'existing factual record'};
 const before=JSON.stringify(state);const b=buildContractTestBundle(c,state,'working-tree-review',new Date(),'latest');
 assert.equal(JSON.stringify(state),before);assert.ok(String(b.entries[0].content).includes('案件に保存された版（変更なし）: 未選択'));
 assert.equal(b.entries.length,10);
});
test('ZIP uses identical HTML entries and unchanged selected legal text', async()=>{
 const {fillTemplate,gatherTemplateContext}=await import('../packages/web/src/web/domain/logic/docs');
 const {buildZip}=await import('../packages/web/src/web/lib/export/zip');
 const {createRequire}=await import('node:module');
 const require=createRequire(new URL('../packages/web/package.json',import.meta.url));
 const {unzipSync,strFromU8}=require('fflate');
 const {buildWordHtml}=await import('../packages/web/src/web/lib/export/word');
 const {c,state}=blankFixture();const bundle=buildContractTestBundle(c,state,'review');const files=unzipSync(buildZip(bundle.entries));
 assert.equal(Object.keys(files).length,10);
 const ctx=gatherTemplateContext(c,state);ctx['甲代表者肩書']='';
 for(const k of ['当該文書番号','見積番号','発注請書番号','検収書番号','報告書番号'])ctx[k]='';
 TEST_DOC_TYPES.forEach((key,i)=>{
  const entry=bundle.entries[i+1];assert.equal(strFromU8(files[entry.name]).replace(/^\uFEFF/,''),entry.content);
  const body=fillTemplate(APPROVED_TERMS_TEMPLATES[key],ctx).text;
  const pre=buildWordHtml({title:'test',body,fileName:''}).match(/<pre>[\s\S]*?<\/pre>/)![0];
  assert.ok(String(entry.content).includes(pre));
 });
});
