import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fillTemplate, gatherTemplateContext, contextWithDocNo, savedDocumentsForExport, referencedDocument } from '../packages/web/src/web/domain/logic/docs';
import { BUILT_IN_TEMPLATES } from '../packages/web/src/web/domain/data/doc-templates';
import { buildWordHtml } from '../packages/web/src/web/lib/export/word';
import type { CaseRecord, VaultState } from '../packages/web/src/web/domain/types';

function fixture() {
  const c = { id:'synthetic', settings:{}, execution:{deliverables:[]}, estimate:{totalIncTax:0}, legalDocs:{estimate:{status:'todo',signedAt:'',docNo:'EST-20261023-001'}}, generatedDocs:[{id:'doc1',docType:'estimate',docNo:'EST-20261023-001',issuedAt:'2026-10-23',status:'draft',content:'  保存済み編集 <A&B>\n\n末尾  '}] } as unknown as CaseRecord;
  return {c, state:{profile:{},cases:[c]} as VaultState};
}
test('zero is a value; missing and whitespace are missing',()=>{
 assert.deepEqual(fillTemplate('{{zero}}|{{blank}}|{{absent}}',{zero:0,blank:'  '}),{text:'0|[要入力:blank]|[要入力:absent]',missing:['blank','absent']});
});
test('no fabricated deliverables, execution or signature dates',()=>{
 const {c,state}=fixture(); c.execution.contractStart='2026-11-01';
 const ctx=gatherTemplateContext(c,state);
 assert.equal(ctx['成果物リスト'],''); assert.equal(ctx['契約締結日'],'');assert.equal(ctx['改訂日'],'');
 c.legalDocs.mainContract={status:'signed',signedAt:'2026-10-25',docNo:'CT-1'};
 assert.equal(gatherTemplateContext(c,state)['契約締結日'],'2026-10-25');
});
test('unconfirmed recommendation is never substituted into estimate',()=>{
 const {c,state}=fixture(); c.pricing={result:{recommended:110000,adjusted:120000}} as any;
 const ctx=gatherTemplateContext(c,state);
 for(const k of ['税抜金額','消費税','税込金額','スポット時間単価']) assert.equal(ctx[k],'');
 c.estimate.totalIncTax=121000;
 const priced=gatherTemplateContext(c,state); assert.equal(priced['税抜金額'],110000);assert.equal(priced['消費税'],11000);assert.equal(priced['税込金額'],121000);
});
test('approved tax floor applies once to confirmed gross estimate',()=>{
 const {c,state}=fixture(); c.estimate.totalIncTax=6;
 const ctx=gatherTemplateContext(c,state);
 assert.equal(ctx['消費税'],0); assert.equal(ctx['税抜金額'],6);
 assert.equal(Number(ctx['税抜金額'])+Number(ctx['消費税']),ctx['税込金額']);
});
test('new number is inserted before generation without changing prior context',()=>{
 const ctx={'見積番号':'EST-old'}; const next=contextWithDocNo(ctx,'estimate','EST-new');
 assert.equal(fillTemplate('番号{{見積番号}}',next).text,'番号EST-new');assert.equal(ctx['見積番号'],'EST-old');
});
test('saved edited body is selected exactly; no regeneration or mutation',()=>{
 const {c}=fixture(); const before=JSON.stringify(c);const docs=savedDocumentsForExport(c,['estimate']);
 assert.equal(docs[0].content,'  保存済み編集 <A&B>\n\n末尾  ');assert.equal(JSON.stringify(c),before);
 docs[0].content='external mutation';assert.equal(c.generatedDocs[0].content,'  保存済み編集 <A&B>\n\n末尾  ');
});
test('same renderer for single and archive preserves escaped text and whitespace',()=>{
 const {c}=fixture();const g=savedDocumentsForExport(c,['estimate'])[0];
 const html=buildWordHtml({title:'見積書',docNo:g.docNo,body:g.content,fileName:''});
 assert.ok(html.includes('<pre>  保存済み編集 &lt;A&amp;B&gt;\n\n末尾  </pre>'));
 const page=readFileSync(new URL('../packages/web/src/web/pages/case/legal.tsx',import.meta.url),'utf8');
 assert.ok(page.includes('content: buildWordHtml(')); assert.ok(!page.includes('function wordHtml('));
});
test('missing, stale reference, duplicates, blank content and invalid numbers fail closed',()=>{
 for(const mode of ['missing','stale','duplicate','empty','invalid','invalid whitespace','unsafe path']) {
  const {c}=fixture();
  if(mode==='missing') c.generatedDocs=[];
  if(mode==='stale') c.legalDocs.estimate.docNo='EST-stale';
  if(mode==='duplicate') c.generatedDocs.push({...c.generatedDocs[0],id:'doc2'});
  if(mode==='empty') c.generatedDocs[0].content='  ';
  if(mode==='invalid') c.legalDocs.estimate.docNo='';
  if(mode==='invalid whitespace') c.legalDocs.estimate.docNo=' EST-20261023-001';
  if(mode==='unsafe path') c.legalDocs.estimate.docNo='../EST-20261023-001';
  const before=JSON.stringify(c);assert.throws(()=>savedDocumentsForExport(c,['estimate']),undefined,mode);assert.equal(JSON.stringify(c),before);
 }
});
test('explicit not-applicable documents are omitted, but empty selection fails',()=>{
 const {c}=fixture();c.legalDocs.dpa={status:'na',signedAt:'',docNo:''};
 assert.equal(savedDocumentsForExport(c,['estimate','dpa']).length,1);
 assert.throws(()=>savedDocumentsForExport(c,['dpa']));
});
test('selected saved signed version remains unchanged even with newer draft',()=>{
 const {c}=fixture();c.legalDocs.estimate.status='signed';c.generatedDocs[0].status='signed';
 c.generatedDocs.push({...c.generatedDocs[0],docNo:'EST-new',id:'new',content:'new draft',status:'draft'});
 const before=JSON.stringify(c);assert.equal(savedDocumentsForExport(c,['estimate'])[0].id,'doc1');assert.equal(referencedDocument(c,'estimate')?.id,'doc1');assert.equal(JSON.stringify(c),before);
});
test('templates do not preselect success or claim completion; DPA links target matching headings',()=>{
 assert.ok(!BUILT_IN_TEMPLATES.deliveryReceipt.includes('■ 合格'));
 assert.ok(BUILT_IN_TEMPLATES.deliveryReceipt.includes('未確認'));
 assert.ok(!BUILT_IN_TEMPLATES.completionReport.includes('準拠確認：実施済'));
 assert.ok(!BUILT_IN_TEMPLATES.completionReport.includes('業務が完了したことを報告'));
 assert.ok(BUILT_IN_TEMPLATES.dpa.includes('AI特約第4条（学習利用への対策）'));
 assert.ok(BUILT_IN_TEMPLATES.aiAddendum.includes('第4条（学習利用への対策）'));
 assert.ok(BUILT_IN_TEMPLATES.dpa.includes('AI特約第2条（秘密情報等の入力禁止）'));
});
test('signed document guard recognises exact saved reference and direct status', async()=>{
 const {isSignedDocument}=await import('../packages/web/src/web/domain/logic/docs');
 const {c}=fixture();c.legalDocs.estimate.status='signed';
 assert.equal(isSignedDocument(c,c.generatedDocs[0]),true);
 assert.equal(isSignedDocument(c,{docType:'estimate',docNo:'other',status:'draft'}),false);
 assert.equal(isSignedDocument(c,{docType:'estimate',docNo:'other',status:'signed'}),true);
});
test('signed viewer cannot edit or persist even when called programmatically',async()=>{
 const {docViewer}=await import('../packages/web/src/web/lib/store/doc-viewer-store');
 let writes=0;
 docViewer.open({docId:'signed-fixture',caseId:'synthetic',title:'署名済み',docNo:'CT-1',company:'',readOnly:true},'Original signed text',()=>{writes++;});
 docViewer.setContent('Changed'); assert.equal(docViewer.getContent(),'Original signed text');
 docViewer.close();assert.equal(writes,0);
});
test('archive rejects duplicate numbers across document types without changes',()=>{
 const {c}=fixture();c.legalDocs.dpa={status:'todo',docNo:c.legalDocs.estimate.docNo,signedAt:''};
 c.generatedDocs.push({...c.generatedDocs[0],id:'dpa',docType:'dpa'});
 const before=JSON.stringify(c);assert.throws(()=>savedDocumentsForExport(c,['estimate','dpa']));assert.equal(JSON.stringify(c),before);
});
test('signing requires saved body and explicit date; signed status/date cannot be downgraded',async()=>{
 const {changeDocumentStatus,changeDocumentSignedAt}=await import('../packages/web/src/web/domain/logic/docs');
 const {c}=fixture();const initial=JSON.stringify(c);
 assert.ok(changeDocumentStatus(c,'estimate','signed'));assert.equal(JSON.stringify(c),initial);
 assert.equal(changeDocumentSignedAt(c,'estimate','2026-10-25'),null);
 assert.equal(changeDocumentStatus(c,'estimate','signed'),null);
 const signed=JSON.stringify(c);
 assert.ok(changeDocumentStatus(c,'estimate','todo'));
 assert.ok(changeDocumentSignedAt(c,'estimate','2027-01-01'));
 assert.equal(JSON.stringify(c),signed);
 assert.equal(c.generatedDocs[0].status,'signed');
});

test('invalid dates, blank body, and duplicate saved references cannot be marked signed',async()=>{
 const {changeDocumentStatus}=await import('../packages/web/src/web/domain/logic/docs');
 for(const mode of ['date','empty','duplicate','missing']) {
  const {c}=fixture(); c.legalDocs.estimate.signedAt='2026-10-25';
  if(mode==='date') c.legalDocs.estimate.signedAt='2026-02-30';
  if(mode==='empty') c.generatedDocs[0].content='  ';
  if(mode==='duplicate') c.generatedDocs.push({...c.generatedDocs[0],id:'duplicate'});
  if(mode==='missing') c.generatedDocs=[];
  const before=JSON.stringify(c);assert.ok(changeDocumentStatus(c,'estimate','signed'));assert.equal(JSON.stringify(c),before);
 }
});
test('actual ZIP bytes contain exactly the single-download HTML including saved edits',async()=>{
 const {downloadWord}=await import('../packages/web/src/web/lib/export/word');
 const {downloadZip}=await import('../packages/web/src/web/lib/export/zip');
 const {createRequire}=await import('node:module');
 const require=createRequire(new URL('../packages/web/package.json',import.meta.url));
 const {unzipSync,strFromU8}=require('fflate');
 const blobs:Blob[]=[];
 const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 const oldCreate=URL.createObjectURL;
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({href:'',download:'',click(){}}),body:{appendChild(){},removeChild(){}}}});
 URL.createObjectURL=(blob)=>{blobs.push(blob as Blob);return `blob:test-${blobs.length}`;};
 try {
  const {c}=fixture();const g=savedDocumentsForExport(c,['estimate'])[0];
  const opts={title:'見積書',docNo:g.docNo,body:g.content,fileName:'single.doc'};
  downloadWord(opts);
  downloadZip('bundle',[{name:'saved.doc',content:buildWordHtml(opts)}]);
  const zipped=unzipSync(new Uint8Array(await blobs[1].arrayBuffer()));
  assert.equal(strFromU8(zipped['saved.doc']),await blobs[0].text());
 } finally {
  URL.createObjectURL=oldCreate;
  if(oldDocument) Object.defineProperty(globalThis,'document',oldDocument);else delete (globalThis as any).document;
 }
});
