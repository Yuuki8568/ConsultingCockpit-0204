import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectNewContractVersion, PENDING_CONTRACT_RELEASE } from '../packages/web/src/web/domain/logic/contract-version';
import { APPROVED_TERMS_VERSION } from '../packages/web/src/web/domain/data/contract-latest';
import { changeDocumentStatus, savedDocumentsForExport } from '../packages/web/src/web/domain/logic/docs';
import type { CaseRecord } from '../packages/web/src/web/domain/types';
const fresh = () => ({generatedDocs:[],legalDocs:{}} as unknown as CaseRecord);
test('new version selection is explicit and does not migrate saved templates or documents',()=>{
 const c=fresh(); assert.equal(c.contractTemplateVersion,undefined);
 assert.equal(selectNewContractVersion(c),null); assert.equal(c.contractTemplateVersion,APPROVED_TERMS_VERSION);
 assert.deepEqual(c.generatedDocs,[]);assert.deepEqual(c.legalDocs,{});
});
test('existing generated or sent/signed cases cannot adopt new version',()=>{
 for(const mode of ['generated','sent','signed','date','number','version']) {
  const c=fresh();
  if(mode==='generated') c.generatedDocs=[{id:'saved'} as any];
  if(mode==='version') c.contractTemplateVersion='older';
  if(mode!=='generated'&&mode!=='version') c.legalDocs.mainContract={status:mode==='signed'?'signed':mode==='sent'?'sent':'todo',signedAt:mode==='date'?'2026-10-01':'',docNo:mode==='number'?'CT-1':''};
  const before=JSON.stringify(c);assert.ok(selectNewContractVersion(c),mode);assert.equal(JSON.stringify(c),before);
 }
});
test('review version cannot be exported/sent/signed even if placeholder text is removed',()=>{
 const c=fresh();c.generatedDocs=[{id:'review',docType:'mainContract',docNo:'CT-1',issuedAt:'2026-10-23',content:'Edited to remove every marker',status:'draft',releaseBlocked:PENDING_CONTRACT_RELEASE,templateVersion:APPROVED_TERMS_VERSION}];
 c.legalDocs.mainContract={docNo:'CT-1',signedAt:'2026-10-23',status:'todo'};
 const before=JSON.stringify(c);
 assert.throws(()=>savedDocumentsForExport(c,['mainContract']),/未承認/);
 assert.ok(changeDocumentStatus(c,'mainContract','sent'));assert.ok(changeDocumentStatus(c,'mainContract','signed'));
 assert.equal(JSON.stringify(c),before);
 const view=readFileSync(new URL('../packages/web/src/web/components/doc-viewer-modal.tsx',import.meta.url),'utf8');
 assert.ok(view.includes('!doc.releaseBlocked && downloadWord('));assert.ok(view.includes('!doc.releaseBlocked && <CopyButton'));
});

test('existing support, agreed pricing or contract dates block adoption without migration',()=>{
 for(const mode of ['support','agreed','period']){
  const c=fresh();
  if(mode==='support')c.support={contract:{noticeDays:30,autoRenew:'3m'}} as any;
  if(mode==='agreed')c.fde={priceStatus:'agreed'} as any;
  if(mode==='period')c.execution={contractStart:'2026-10-01'} as any;
  const before=JSON.stringify(c);assert.ok(selectNewContractVersion(c));assert.equal(JSON.stringify(c),before);
 }
});

test('normalization preserves version, review gate, signed body and fee basis without adopting old cases',async()=>{
 const {makeEmptyCase,normalizeCase}=await import('../packages/web/src/web/domain/logic/state');
 const newlyCreated=makeEmptyCase('SYNTHETIC');assert.equal(newlyCreated.contractTemplateVersion,undefined);
 const old=makeEmptyCase('SYNTHETIC');delete old.contractTemplateVersion; normalizeCase(old);assert.equal(old.contractTemplateVersion,undefined);
 const c=makeEmptyCase('SYNTHETIC');assert.equal(selectNewContractVersion(c),null);
 c.generatedDocs=[{id:'saved',docType:'mainContract',docNo:'CT-1',issuedAt:'2026-10-23',content:'  unchanged body\n ',status:'signed',releaseBlocked:PENDING_CONTRACT_RELEASE,templateVersion:APPROVED_TERMS_VERSION}];
 c.reports=[{id:'r',month:'2026-10',consultFee:33000,consultFeeTaxBasis:'gross'} as any];
 normalizeCase(c);
 assert.equal(c.contractTemplateVersion,APPROVED_TERMS_VERSION);
 assert.equal(c.generatedDocs[0].content,'  unchanged body\n ');
 assert.equal(c.generatedDocs[0].releaseBlocked,PENDING_CONTRACT_RELEASE);assert.equal(c.generatedDocs[0].status,'signed');
 assert.equal(c.reports[0].consultFeeTaxBasis,'gross');assert.equal(c.reports[0].consultFee,33000);
});
