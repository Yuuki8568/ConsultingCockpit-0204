import { APPROVED_TERMS_VERSION as LATEST } from '../packages/web/src/web/domain/data/contract-latest';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {APPROVED_TERMS_VERSION as V, APPROVED_TERMS_TEMPLATES as T, PREVIOUS_VERSION, PREVIOUS_TEMPLATES,templatesForVersion} from '../packages/web/src/web/domain/data/contract-revisions';
import {missingContractFacts,contractFactsContext} from '../packages/web/src/web/domain/logic/contract-facts';
import {unresolvedContractMarkers} from '../packages/web/src/web/domain/logic/contract-placeholders';
import {gatherTemplateContext,fillTemplate,recheckDocumentRelease,documentReleaseBlock,changeDocumentStatus} from '../packages/web/src/web/domain/logic/docs';
import {contractGenerationBlock,selectNewContractVersion} from '../packages/web/src/web/domain/logic/contract-version';
import {buildContractTestBundle} from '../packages/web/src/web/lib/export/contract-test';
import {makeEmptyCase,normalizeCase} from '../packages/web/src/web/domain/logic/state';
import type {CaseRecord,VaultState} from '../packages/web/src/web/domain/types';
const fixture=()=>{const c=makeEmptyCase('SYNTHETIC');c.contractTemplateVersion=V;c.contractFacts={transactionPurpose:'business',legalApplicability:'合成適用確認',documentVersions:'合成ID版',noticeDestination:'test@example.invalid',noticeMethod:'合成到達方式',informationManagement:'合成管理票',retentionDeletion:'合成削除条件',aiUse:'none',ndaCapBasis:'standalone'};return c;};
test('previous approved source frozen byte-for-byte at deployed parent; registry selects old separately',()=>{
 const path='packages/web/src/web/domain/data/approved-terms.ts';
 // SHA256 of the deployed 25fc70d source, independent of shallow CI history.
 assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),'a8e77f5a60d37e5ce6c1d81d78e08977b87e82b199be03c267f0275bd5003ede');
 assert.equal(templatesForVersion(PREVIOUS_VERSION),PREVIOUS_TEMPLATES);assert.equal(templatesForVersion(V),T);
 assert.ok(PREVIOUS_TEMPLATES.deliveryReceipt.includes('納品日から14日以内に本検収書'));assert.ok(!T.deliveryReceipt.includes('納品日から14日以内に本検収書'));
});
test('receipt uses receipt-date and pass/fail notification, no issued-document prerequisite',()=>{
 assert.ok(T.deliveryReceipt.includes('成果物の納品を受けた日から14日以内に、甲から乙へ合格または不合格の通知が行われない場合'));
 assert.ok(T.mainContract.includes('納品を受けた日から14日以内'));
});
test('NDA self-contained bilateral cap, ordinary attorney costs inside cap, exceptions unchanged',()=>{
 for(const s of ['双方について','直接かつ通常の損害','税込報酬総額','暦上の3か月間','弁護士費用','通常の賠償上限の内側','故意または重大な過失','反社会的勢力の排除条項違反']) assert.ok(T.nda.includes(s),s);
 assert.ok(!T.nda.includes('本契約は、別途締結する'));
 assert.ok(!T.nda.includes('現実に発生した損害（弁護士費用を含む。）を賠償する。'));
});
test('standalone NDA requires cap agreement but not future paid services',()=>{
 const c=fixture();assert.ok(missingContractFacts(c,'nda').some(s=>s.includes('個別賠償')));
 c.contractFacts!.individualCapAgreement='合成上限税込33000円・CAP-SYNTHETIC・2026-10-24';assert.deepEqual(missingContractFacts(c,'nda'),[]);
 const ctx=contractFactsContext(c);assert.ok(ctx['NDA参照原契約'].includes('未締結'));assert.equal(ctx['賠償算定確認'],'');
 assert.equal(fillTemplate(T.nda,ctx).missing.filter(k=>k.startsWith('NDA')).length,0);
});
test('NDA main-reference requires explicit ID/version/real signing date and zero-cap assessment',()=>{
 const c=fixture();c.contractFacts!.ndaCapBasis='main_contract';assert.ok(missingContractFacts(c,'nda').length>=5);
 Object.assign(c.contractFacts!,{originalContractId:'CT-SYNTHETIC',originalContractVersion:PREVIOUS_VERSION,originalContractSignedOn:'2026-10-20',liabilityAssessment:'合成算定記録',zeroLiability:'zero_or_possible'});
 assert.ok(missingContractFacts(c,'nda').some(s=>s.includes('個別賠償')));
 c.contractFacts!.individualCapAgreement='合成上限税込33000円・CAP-SYNTHETIC・2026-10-24';assert.deepEqual(missingContractFacts(c,'nda'),[]);
});
test('DPA signing date separate from service start; invalid and invented dates never accepted',()=>{
 const c=fixture();c.execution={contractStart:'2026-11-01',deliverables:[]} as any;const state={profile:{},cases:[c]} as VaultState;
 assert.equal(gatherTemplateContext(c,state)['原契約締結日'],'');assert.ok(missingContractFacts(c,'dpa').length>=4);
 Object.assign(c.contractFacts!,{originalContractId:'CT-SYNTHETIC',originalContractVersion:PREVIOUS_VERSION,originalContractSignedOn:'2026-02-30',dpaImplementationEvidence:'合成実施確認'});assert.ok(missingContractFacts(c,'dpa').length>0);
 c.contractFacts!.originalContractSignedOn='2026-10-20';assert.deepEqual(missingContractFacts(c,'dpa'),[]);assert.equal(gatherTemplateContext(c,state)['原契約締結日'],'2026-10-20');assert.ok(!T.dpa.includes('{{契約開始日}}付'));
});
test('contextual placeholders block formal but legitimate circles and checkboxes do not',()=>{
 for(const s of ['月○回','毎月○日','約○○件','○時間','令和○年○月○日','○○,○○○円','［要確認：設定］','［成果物名］','{{未入力}}','[要入力:金額]']) assert.ok(unresolvedContractMarkers(s).length,s);
 for(const s of ['□ 合格 □ 不合格','○ 合格／× 不合格','○印で選択してください','○○株式会社']) assert.deepEqual(unresolvedContractMarkers(s),[],s);
});
test('saved unsigned NDA is blocked even if old release flag absent, sent/sign gated',()=>{
 const c=fixture();const doc={id:'x',docType:'nda',docNo:'NDA-SYNTHETIC',issuedAt:'2026-10-24',content:'synthetic body',templateVersion:V,status:'draft' as const};c.generatedDocs=[doc];c.legalDocs.NDA={status:'todo',docNo:doc.docNo,signedAt:'2026-10-24'};
 assert.ok(documentReleaseBlock(c,doc));assert.ok(changeDocumentStatus(c,'nda','sent'));assert.ok(changeDocumentStatus(c,'nda','signed'));
 c.contractFacts!.individualCapAgreement='合成税込33000円 CAP-ID 2026-10-24';assert.equal(documentReleaseBlock(c,doc),undefined);
 doc.content='［要確認：合意］';assert.ok(documentReleaseBlock(c,doc));
});
test('new cases explicitly choose revision; old/signed/generated versions cannot be changed',()=>{
 const n=makeEmptyCase('SYNTHETIC');assert.equal(n.contractTemplateVersion,undefined);assert.ok(contractGenerationBlock(n));assert.equal(selectNewContractVersion(n),null);assert.equal(contractGenerationBlock(n),null);assert.equal(n.contractTemplateVersion,LATEST);
 const c=fixture();c.contractTemplateVersion=PREVIOUS_VERSION;const original=JSON.stringify(c);assert.ok(selectNewContractVersion(c));assert.equal(JSON.stringify(c),original);
 c.generatedDocs=[{id:'signed',docType:'nda',docNo:'NDA-OLD',issuedAt:'2026-10-23',templateVersion:PREVIOUS_VERSION,status:'signed',content:'SIGNED ORIGINAL ○ ［残した文言］'}];c.legalDocs.NDA={status:'signed',docNo:'NDA-OLD',signedAt:'2026-10-23'};
 const signed=JSON.stringify(c.generatedDocs);normalizeCase(c);assert.equal(JSON.stringify(c.generatedDocs),signed);assert.equal(documentReleaseBlock(c,c.generatedDocs[0]),undefined);
});
test('TEST latest nine documents never mutate old/signed cases or claim implementation',()=>{
 const c=fixture();c.contractTemplateVersion=PREVIOUS_VERSION;c.legalDocs.NDA={status:'signed',docNo:'NDA-OLD',signedAt:'2026-10-23'};
 const state={profile:{},cases:[c],docTemplates:{}} as VaultState;const before=JSON.stringify(state);const b=buildContractTestBundle(c,state,'SYNTHETIC-SOURCE',new Date('2026-10-24T02:00Z'),'latest');
 assert.equal(b.entries.filter(x=>x.name.endsWith('.doc')).length,9);assert.equal(JSON.stringify(state),before);assert.ok(String(b.entries[0].content).includes(LATEST));
 const dpa=String(b.entries.find(x=>x.name.includes('DPA'))!.content);assert.ok(dpa.includes('要入力:原契約締結日'));assert.ok(dpa.includes('実施証明ではない'));
 const rpt=String(b.entries.find(x=>x.name.includes('業務完了'))!.content);assert.ok(rpt.includes('要入力:完了精算確認'));assert.ok(rpt.includes('要入力:完了AI確認'));assert.ok(!rpt.includes('（案件条件票の料金明細）円'));
});

test('explicit re-review resolves only new factual gate; old approval holds and signed bodies unchanged',()=>{
 const c=fixture();const d={id:'review',docType:'nda',docNo:'NDA-TEST',issuedAt:'2026-10-24',content:'月○回',templateVersion:V,releaseBlocked:'案件未確認',releaseBlockKind:'case_facts_review' as const};c.generatedDocs=[d];
 assert.ok(recheckDocumentRelease(c,d.id));c.contractFacts!.individualCapAgreement='合成税込33000円 CAP-ID 2026-10-24';assert.ok(recheckDocumentRelease(c,d.id));
 d.content='合成検証用の確認済み本文';assert.equal(recheckDocumentRelease(c,d.id),null);assert.equal(documentReleaseBlock(c,d),undefined);
 d.releaseBlocked='未承認の重要条件';const before=JSON.stringify(d);assert.ok(recheckDocumentRelease(c,d.id));assert.equal(JSON.stringify(d),before);
 d.templateVersion=PREVIOUS_VERSION;assert.ok(recheckDocumentRelease(c,d.id));
});
