import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import {APPROVED_TERMS_VERSION as V,APPROVED_TERMS_TEMPLATES as T,templatesForVersion} from '../packages/web/src/web/domain/data/contract-latest';
import {APPROVED_TERMS_VERSION as V2,APPROVED_TERMS_TEMPLATES as T2} from '../packages/web/src/web/domain/data/contract-revisions';
import {serviceScopeBlock} from '../packages/web/src/web/domain/logic/service-scope';import {missingContractFacts} from '../packages/web/src/web/domain/logic/contract-facts';
import {documentReleaseBlock,changeDocumentStatus,recheckDocumentRelease} from '../packages/web/src/web/domain/logic/docs';import {contractActions} from '../packages/web/src/web/domain/logic/contract-actions';
import {makeEmptyCase,normalizeCase} from '../packages/web/src/web/domain/logic/state';import {selectNewContractVersion} from '../packages/web/src/web/domain/logic/contract-version';
import {buildContractTestBundle} from '../packages/web/src/web/lib/export/contract-test';import {generateProposalSkeleton} from '../packages/web/src/web/domain/logic/sheet';import type {VaultState} from '../packages/web/src/web/domain/types';
const fixture=()=>{const c=makeEmptyCase('SYNTHETIC');c.contractTemplateVersion=V;c.contractFacts={transactionPurpose:'business',legalApplicability:'合成適用確認',documentVersions:'合成ID版',noticeDestination:'test@example.invalid',noticeMethod:'合成到達',informationManagement:'合成管理票',retentionDeletion:'合成削除条件',aiUse:'none',ndaCapBasis:'standalone',individualCapAgreement:'合成税込33000円/CAP-ID/2026-10-24',scopeAndDeliverables:'合成作業範囲',acceptanceAndCompletion:'合成検収条件',pricingAndExpenses:'合成税込条件',liabilityAssessment:'合成算定',zeroLiability:'nonzero'};return c;};
const allowed=()=>{const c=fixture();Object.assign(c.contractFacts!,{serviceRequestSummary:'補助金制度の一般情報を調べ、受注集計の二重入力を改善する。申請書類の作成代行・提出代理は対象外。',serviceScopeClassification:'business_improvement',serviceScopeReviewEvidence:'合成記録2026-10-24/確認者TEST/通常業務改善のみ、対象外を分離'});return c;};
test('revision2 source and outputs frozen; revision3 never falls back or migrates versions',()=>{
 const p='packages/web/src/web/domain/data/contract-revisions.ts';assert.equal(createHash('sha256').update(readFileSync(p)).digest('hex'),'3f457d6b3bd2278de3aa0179f5fdaf40f797d0948f29f6d3e992ac1177024c87');
 assert.equal(templatesForVersion(V2),T2);assert.notEqual(T.disclaimer,T2.disclaimer);assert.ok(T2.disclaimer.includes('2026年1月1日施行の改正行政書士法により'));
 for(const version of ['2026-10-23-approved-1',V2]){const c=fixture();c.contractTemplateVersion=version;const before=JSON.stringify(c);assert.ok(selectNewContractVersion(c));assert.equal(JSON.stringify(c),before);}
});
test('legal explanation includes request reward business and exceptions, separate from provider scope',()=>{
 for(const term of ['他人の依頼','報酬','業として','第1条の3','ただし書','例外','趣旨を明確化','【当事務所の提供範囲】','【法令の説明】','すべての支援を一律に']) assert.ok(T.disclaimer.includes(term),term);
 for(const term of ['申請用事業計画書','実質的な代筆','提出代行・代理','確認が終わるまで受託・着手しません']){assert.ok(T.disclaimer.includes(term));assert.ok(T.mainContract.includes(term));}
});
test('invoice renewal cap and ordinary attorney clause unchanged except revision label',()=>{
 for(const key of ['estimate','purchaseOrder','nda','dpa','aiAddendum','deliveryReceipt','completionReport','monthlySupportContract'] as const) assert.equal(T[key],T2[key].split(V2).join(V));
 const section=(s:string,a:string,b:string)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)+a.length));
 for(const [a,b] of [['第3条','第5条'],['第16条','第18条']]) assert.equal(section(T.mainContract,a,b),section(T2.mainContract,a,b));
});
test('unconfirmed scope blocks service formal release, but NDA screening can proceed safely',()=>{
 const c=fixture();assert.ok(serviceScopeBlock(c));assert.ok(missingContractFacts(c).some(s=>s.includes('受託前')));assert.equal(serviceScopeBlock(c,'nda'),null);assert.deepEqual(missingContractFacts(c,'nda'),[]);
});
test('explicit application preparation and submission remain excluded despite entered evidence',()=>{
 for(const kind of ['application_preparation','application_submission'] as const){const c=allowed();c.contractFacts!.serviceScopeClassification=kind;assert.match(serviceScopeBlock(c)!,/受託対象外/);assert.ok(missingContractFacts(c,'estimate').length);}
});
test('explicit application drafting/proxy text cannot be overridden by ordinary-DX classification',()=>{
 for(const text of ['補助金の申請書類を作成する','申請用事業計画書の作成代行','助成金申請の提出代理を依頼','申請書を代筆してほしい']){const c=allowed();c.contractFacts!.serviceRequestSummary=text;assert.match(serviceScopeBlock(c)!,/受託対象外/,text);}
});
test('application editing support is review-required, not automatically legally adjudicated',()=>{
 for(const text of ['申請書の添削サポート','申請用事業計画書の編集支援','申請書の助言']){const c=allowed();c.contractFacts!.serviceRequestSummary=text;assert.match(serviceScopeBlock(c)!,/確認待ち/,text);}
});
test('generic subsidy mention and ordinary DX are not automatically excluded; human evidence remains necessary',()=>{
 const c=allowed();assert.equal(serviceScopeBlock(c),null);assert.deepEqual(missingContractFacts(c),[]);c.contractFacts!.serviceScopeReviewEvidence='';assert.ok(serviceScopeBlock(c));
});
test('scope gate blocks saved formal export and sent/signed status and cannot be cleared through factual re-review',()=>{
 const c=allowed();c.contractFacts!.serviceScopeClassification='application_preparation';const d={id:'x',docType:'mainContract',docNo:'CT-TEST',issuedAt:'2026-10-24',content:'合成本文',templateVersion:V,releaseBlocked:'確認待ち',releaseBlockKind:'case_facts_review' as const};c.generatedDocs=[d];c.legalDocs.mainContract={status:'todo',docNo:d.docNo,signedAt:'2026-10-24'};
 assert.ok(documentReleaseBlock(c,d));assert.ok(changeDocumentStatus(c,'mainContract','sent'));assert.ok(changeDocumentStatus(c,'mainContract','signed'));assert.ok(recheckDocumentRelease(c,d.id));assert.equal(d.releaseBlocked,'確認待ち');
 c.contractFacts!.serviceScopeClassification='business_improvement';assert.equal(recheckDocumentRelease(c,d.id),null);assert.equal(documentReleaseBlock(c,d),undefined);
});
test('action panel includes explicit scope action for excluded or unconfirmed new version, no old-case migration',()=>{
 const c=fixture();assert.ok(contractActions(c,[],{},'2026-10-24').some(a=>a.id==='service-scope'));c.contractTemplateVersion=V2;assert.ok(!contractActions(c,[],{},'2026-10-24').some(a=>a.id==='service-scope'));
});
test('signed version2 immutable and blank latest TEST9 remains possible',()=>{
 const c=fixture();c.contractTemplateVersion=V2;c.generatedDocs=[{id:'s',docType:'mainContract',docNo:'SIGNED',issuedAt:'2026-10-23',status:'signed',content:'SIGNED ORIGINAL',templateVersion:V2}];c.legalDocs.mainContract={status:'signed',docNo:'SIGNED',signedAt:'2026-10-23'};normalizeCase(c);const state={profile:{},cases:[c],docTemplates:{}} as VaultState;const before=JSON.stringify(state);const b=buildContractTestBundle(c,state,'TEST-SOURCE',new Date(),'latest');assert.equal(b.entries.length,10);assert.equal(JSON.stringify(state),before);assert.ok(String(b.entries[0].content).includes(V));assert.equal(documentReleaseBlock(c,c.generatedDocs[0]),undefined);
});
test('new proposal explains same scope without invented partnership or obsolete renewal and blanket exemption; saved proposal untouched',()=>{
 const c=fixture();c.proposal={premise:'SAVED ORIGINAL'} as any;const before=JSON.stringify(c);const p=generateProposalSkeleton(c,{profile:{},cases:[c]} as VaultState);
 assert.ok(p.premise.includes('受託判断保留'));assert.ok(p.premise.includes('実質的な代筆'));assert.ok(!p.premise.includes('提携の行政書士'));assert.ok(!p.premise.includes('初回6ヶ月'));assert.ok(!p.premise.includes('誤情報の責任を負いません'));assert.equal(JSON.stringify(c),before);
});

test('intake knownInfo and agreed scope cannot hide an explicit excluded request behind an allowed dropdown',()=>{
 const c=allowed();c.settings.knownInfo='補助金の申請書類の作成代行を希望';assert.match(serviceScopeBlock(c)!,/受託対象外/);c.settings.knownInfo='';c.contractFacts!.scopeAndDeliverables='申請用事業計画書の代筆';assert.match(serviceScopeBlock(c)!,/受託対象外/);
});

test('other-party drafting reference is not our drafting request; unrelated exclusion cannot hide positive request',()=>{
 const c=allowed();c.contractFacts!.serviceRequestSummary='申請書類は顧客が作成し、当事務所は通常の集計業務改善のみ';assert.equal(serviceScopeBlock(c),null);
 for(const s of ['集計は対象外、申請書類の作成代行を依頼','申請書類の作成代行は対象外だが申請書を代筆してほしい']){c.contractFacts!.serviceRequestSummary=s;assert.match(serviceScopeBlock(c)!,/受託対象外/);}
});
test('scope change after workspace exists stops new start/task/service actions and preserves historical records',async()=>{
 const {executionScopeMutationBlock,supportScopeMutationBlock}=await import('../packages/web/src/web/domain/logic/service-scope');const c=allowed();c.contractFacts!.serviceScopeClassification='application_submission';
 const ex={contractStart:'2026-10-01',tasks:[{id:'t',status:'todo',note:'historical'}],buildStages:{s1:{status:'todo',agreedAt:''}},runItems:[],deliverables:[],incidents:[]} as any;
 for(const edit of [(e:any)=>e.contractStart='2026-11-01',(e:any)=>e.tasks[0].status='inprogress',(e:any)=>e.tasks.push({id:'new',status:'todo'}),(e:any)=>e.buildStages.s1.status='doing',(e:any)=>e.runItems.push({id:'run',state:'running'})]){const next=structuredClone(ex);edit(next);assert.ok(executionScopeMutationBlock(c,ex,next));}
 const running=structuredClone(ex);running.runItems=[{id:'r',state:'running'}];const stopped=structuredClone(running);stopped.runItems[0].state='safeStopped';assert.equal(executionScopeMutationBlock(c,running,stopped),null);
 const incident=structuredClone(ex);incident.incidents.push({summary:'history'});assert.equal(executionScopeMutationBlock(c,ex,incident),null);assert.equal(ex.tasks[0].note,'historical');
 const sp={contract:{startDate:'2026-10-01',autoRenew:'none'},scope:{included:['original'],excluded:[]},nextMonthChoice:{choice:'',agreedAt:'',note:''}} as any;
 for(const edit of [(s:any)=>s.contract.startDate='2026-11-01',(s:any)=>s.scope.included.push('new work'),(s:any)=>s.contract.autoRenew='1m',(s:any)=>s.nextMonthChoice.choice='continue']){const next=structuredClone(sp);edit(next);assert.ok(supportScopeMutationBlock(c,sp,next));}
 const end=structuredClone(sp);end.nextMonthChoice.choice='end';assert.equal(supportScopeMutationBlock(c,sp,end),null);
});

test('customer requesting us to draft is not confused with customer self-drafting',()=>{const c=allowed();for(const text of ['顧客が申請書類の作成代行を依頼している','申請者が申請用事業計画書の代筆を希望']){c.contractFacts!.serviceRequestSummary=text;assert.match(serviceScopeBlock(c)!,/受託対象外/);}});
