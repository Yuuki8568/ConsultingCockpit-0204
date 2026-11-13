import test from 'node:test';
import assert from 'node:assert/strict';
import { missingContractFacts, contractFactsContext } from '../packages/web/src/web/domain/logic/contract-facts';
import { gatherTemplateContext, fillTemplate, contextWithDocNo, changeDocumentStatus, savedDocumentsForExport } from '../packages/web/src/web/domain/logic/docs';
import { APPROVED_TERMS_TEMPLATES, APPROVED_TERMS_VERSION } from '../packages/web/src/web/domain/data/approved-terms';
import type { CaseRecord, ContractFacts, VaultState } from '../packages/web/src/web/domain/types';
const facts:ContractFacts={transactionPurpose:'business',legalApplicability:'当事者・継続歴を確認した合成記録',documentVersions:'本書は未署名の確認対象、その他NDA番号SYNTHETIC-1版2026-10-23',noticeDestination:'synthetic@example.invalid',noticeMethod:'指定メール到達記録・不達時指定連絡手段',scopeAndDeliverables:'合成仕様書A：納期・対象外・支援枠・成果物・専用/汎用知財区分を確認',acceptanceAndCompletion:'合成仕様書Aに検収条件・完了条件・窓口・是正/追加変更・保守なしを記録',pricingAndExpenses:'固定税込33000円、時間制なし、別途実費なし、専用成果物対価33000円',informationManagement:'合成管理票：保存基盤・権限・コピー・閲覧者・委託先確認',retentionDeletion:'合成管理票：証憑保存根拠、預かりデータ返還削除期限・バックアップ保持確認',aiUse:'none',liabilityAssessment:'合成記録：事由単位・基準日・暦月3か月・実費/返金除外を確認',zeroLiability:'nonzero'};
function fixture(){return {contractTemplateVersion:APPROVED_TERMS_VERSION,contractFacts:{...facts},settings:{companyName:'合成株式会社',kakuyaku:{companyAddress:'合成住所',representative:'合成代表',contact:'合成担当',contactEmail:'synthetic@example.invalid',harassmentContact:'合成窓口（実態確認）'}},execution:{contractType:'single',contractStart:'2026-11-01',contractEnd:'2026-11-30',deliverables:[]},estimate:{totalIncTax:33000},invoice:{},legalDocs:{},generatedDocs:[]} as unknown as CaseRecord;}
test('unconfirmed and consumer facts never become B2B approved facts automatically',()=>{
 const c=fixture();assert.deepEqual(missingContractFacts(c),[]);
 delete c.contractFacts; assert.ok(missingContractFacts(c).length>0);assert.equal(c.contractFacts,undefined);
 c.contractFacts={...facts,transactionPurpose:'consumer'};assert.ok(missingContractFacts(c).some(x=>x.includes('取引目的')));
});
test('AI selection is not evidence: unprocessed input needs prior written consent and verified safeguards',()=>{
 const c=fixture(); c.contractFacts!.aiUse='unprocessed';
 assert.equal(missingContractFacts(c).length,3);
 c.contractFacts!.aiServiceRecord='synthetic plan+input/settings/retention/crossborder';
 c.contractFacts!.aiConsentEvidence='synthetic consent doc ID/date/scope';assert.equal(missingContractFacts(c).length,1);
 c.contractFacts!.aiProtectionEvidence='synthetic verified evidence';assert.deepEqual(missingContractFacts(c),[]);
});
test('zero or possible zero cap blocks until explicit individual agreement without fabricated minimum',()=>{
 const c=fixture();c.contractFacts!.zeroLiability='zero_or_possible';
 assert.ok(missingContractFacts(c).some(x=>x.includes('個別賠償')));assert.equal(contractFactsContext(c)['個別賠償上限合意'],'');
 c.contractFacts!.individualCapAgreement='合成合意：上限33000円、文書ID S-CAP、2026-10-23';assert.deepEqual(missingContractFacts(c),[]);
});
test('standalone NDA does not require future services or price agreement',()=>{
 const c=fixture();delete c.contractFacts!.scopeAndDeliverables;delete c.contractFacts!.pricingAndExpenses;delete c.contractFacts!.acceptanceAndCompletion;delete c.contractFacts!.liabilityAssessment;delete c.contractFacts!.zeroLiability;
 assert.deepEqual(missingContractFacts(c,'nda'),[]);assert.ok(missingContractFacts(c,'mainContract').length>0);
});
test('approved new contract can be prepared before signature without inventing delivery or signature facts',()=>{
 const c=fixture();const state={profile:{name:'合成乙',yago:'合成事務所',address:'合成住所',email:'synthetic@example.invalid',url:'https://example.invalid'},cases:[c]} as VaultState;
 const ctx=contextWithDocNo(gatherTemplateContext(c,state),'mainContract','CT-SYNTHETIC-1');
 const filled=fillTemplate(APPROVED_TERMS_TEMPLATES.mainContract,ctx);
 assert.equal(ctx['契約締結日'],'');assert.equal(ctx['成果物リスト'],'');
 assert.ok(!filled.missing.includes('契約締結日'));assert.ok(!filled.missing.includes('成果物リスト'));
 assert.ok(!filled.missing.includes('スポット時間単価'));assert.ok(!filled.missing.includes('月額固定報酬'));
 assert.ok(filled.text.includes('CT-SYNTHETIC-1'));assert.deepEqual(filled.missing,[]);
});

test('order acknowledgement requires an actual verified order date rather than generation date',()=>{
 const c=fixture();assert.ok(missingContractFacts(c,'purchaseOrder').includes('確認済みの発注日'));
 c.contractFacts!.orderReceivedOn='2026-02-30';assert.ok(missingContractFacts(c,'purchaseOrder').includes('確認済みの発注日'));
 c.contractFacts!.orderReceivedOn='2026-10-20';assert.deepEqual(missingContractFacts(c,'purchaseOrder'),[]);
 assert.equal(contractFactsContext(c)['発注日'],'2026-10-20');
 assert.ok(APPROVED_TERMS_TEMPLATES.purchaseOrder.includes('3. 業務委託をした日（確認済み）：{{発注日}}'));
});

test('new version cannot be marked sent without matching saved complete approved body and facts',()=>{
 const c=fixture();assert.ok(changeDocumentStatus(c,'mainContract','sent'));
 c.legalDocs.mainContract={docNo:'CT-1',signedAt:'',status:'todo'};
 c.generatedDocs=[{id:'d',docType:'mainContract',docNo:'CT-1',issuedAt:'2026-10-23',content:'合成本文',status:'draft',templateVersion:APPROVED_TERMS_VERSION}];
 delete c.contractFacts!.informationManagement;assert.ok(changeDocumentStatus(c,'mainContract','sent'));
 c.contractFacts!.informationManagement=facts.informationManagement;assert.equal(changeDocumentStatus(c,'mainContract','sent'),null);
});

test('clearing current facts blocks unsigned approved export but does not mutate signed evidence',()=>{
 const c=fixture();c.legalDocs.mainContract={docNo:'CT-1',signedAt:'',status:'todo'};
 c.generatedDocs=[{id:'d',docType:'mainContract',docNo:'CT-1',issuedAt:'2026-10-23',content:'合成の確認済み保存本文',status:'draft',templateVersion:APPROVED_TERMS_VERSION}];
 assert.equal(savedDocumentsForExport(c,['mainContract']).length,1);
 delete c.contractFacts!.informationManagement;assert.throws(()=>savedDocumentsForExport(c,['mainContract']));
 c.generatedDocs[0].status='signed';const before=JSON.stringify(c);assert.equal(savedDocumentsForExport(c,['mainContract'])[0].content,'合成の確認済み保存本文');assert.equal(JSON.stringify(c),before);
});
