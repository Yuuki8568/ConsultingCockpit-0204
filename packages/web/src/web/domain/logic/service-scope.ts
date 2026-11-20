import type { CaseRecord, Execution, Support } from '../types';
import { APPROVED_TERMS_VERSION } from '../data/contract-latest';
export const SERVICE_SCOPE_LABELS: Record<string,string> = {business_improvement:'通常の業務改善（申請書類の作成・提出代行等を含まない）',general_information:'一般的な制度情報の提供のみ',application_preparation:'申請書類・申請用事業計画書の作成代行・代筆（受託対象外）',application_submission:'申請の提出代行・代理（受託対象外）',needs_review:'法的区分・実質的な作成代行の該当性が未確認'};
/** Risk triage only, not legal classification. An explicit excluded request cannot be cleared by a confirmation checkbox. */
export function serviceScopeBlock(c:CaseRecord, docType='mainContract'): string | null {
 if(c.contractTemplateVersion!==APPROVED_TERMS_VERSION||docType==='nda') return null;
 const f=c.contractFacts??{};const kind=f.serviceScopeClassification;
 if(kind==='application_preparation'||kind==='application_submission') return '受託対象外：補助金・助成金の申請書類・申請用事業計画書の作成代行・代筆、提出代行・代理は受託・着手できません。確認記録を入力しても解除しません。';
 const request=f.serviceRequestSummary?.trim()??'';
 // Only the actual requested work is triaged. A subsidy mention alone is not a legal finding.
 const requestedText=[request,c.settings?.knownInfo??'',f.scopeAndDeliverables??''].join('。');
 const clauses=requestedText.replace(/ただし|しかし|一方|だが/g,'。').split(/[。、\n；;]/).map(s=>s.trim()).filter(Boolean);
 const application=/(?:申請(?:用)?(?:書類?|書|事業計画書)|補助金申請|助成金申請)/;
 const relevant=clauses.filter(s=>application.test(s));
 const isNegative=(s:string)=>/(?:作成|代筆|代行|代理)[^。、]{0,12}(?:対象外|行わない|含まない|受託しない|しない)/.test(s);
 const otherParty=(s:string)=>/(?:顧客|本人|お客様|申請者)(?:が|自身が|自ら)(?:自分で)?作成(?:する|し|済み|して)/.test(s)&&!/(?:依頼|希望|ほしい|欲しい|頼)/.test(s);
 const excluded=relevant.some(s=>!isNegative(s)&&!otherParty(s)&&/(?:作成代行|代筆|提出代行|提出代理|代理提出|代理入力|作成(?:する|して|を依頼|を希望))/.test(s));
 if(excluded) return '受託対象外の申請書類作成・提出代行等を含む依頼が記録されています。名称やチェックだけで通さず、対象外業務を受託しないでください。法的違反の自動判定ではなく当事務所の提供範囲の確認です。';
 const ambiguous=relevant.some(s=>!isNegative(s)&&!otherParty(s)&&/(?:作成|添削|編集|支援|サポート|助言)/.test(s));
 if(ambiguous||kind==='needs_review') return '確認待ち：申請関連の助言・添削等が実質的な作成代行に当たらないか、適用法令・資格要件と依頼内容を担当者が確認するまで受託・着手できません。';
 if(!request||!['business_improvement','general_information'].includes(kind??'')||!f.serviceScopeReviewEvidence?.trim()) return '受託前に依頼業務概要・業務区分・担当者による確認記録（確認日、対象外の切り分け、必要な確認先等）を記入してください。';
 return null;
}

/** Stops new operational actions, not reading or documenting earlier incidents. No agreed contract is canceled. */
export function executionScopeMutationBlock(c:CaseRecord,before:Execution|null,after:Execution):string|null {
 const reason=serviceScopeBlock(c);if(!reason)return null;
 if(!before)return reason;
 const changedStart=Boolean(after.contractStart)&&after.contractStart!==before.contractStart;
 const newTasks=(after.tasks??[]).some(t=>{const old=(before.tasks??[]).find(o=>o.id===t.id);return !old||t.status!==old.status&&['doing','inprogress','done'].includes(t.status);});
 const newStages=Object.entries(after.buildStages??{}).some(([k,v])=>{const old=before.buildStages?.[k as keyof Execution['buildStages']];return ['doing','done'].includes(v.status)&&v.status!==old?.status||Boolean(v.agreedAt)&&v.agreedAt!==old?.agreedAt;});
 const newRuns=(after.runItems??[]).some(t=>{const old=(before.runItems??[]).find(o=>o.id===t.id);return !old||t.state!==old.state&&!['draft','inputMissing','failed','safeStopped','closed'].includes(t.state);});
 const newDelivery=(after.deliverables??[]).some((d,i)=>d.status==='delivered'&&d.status!==before.deliverables?.[i]?.status);
 return changedStart||newTasks||newStages||newRuns||newDelivery ? reason:null;
}
export function supportScopeMutationBlock(c:CaseRecord,before:Support|null,after:Support):string|null {
 const reason=serviceScopeBlock(c);if(!reason)return null;if(!before)return reason;
 const start=Boolean(after.contract.startDate)&&after.contract.startDate!==before.contract.startDate;
 const expand=JSON.stringify(after.scope.included)!==JSON.stringify(before.scope.included)&&after.scope.included.length>0;
 const renewal=after.contract.autoRenew!==before.contract.autoRenew&&!['none',''].includes(after.contract.autoRenew);
 const choice=after.nextMonthChoice?.choice;const continuation=['continue','shrink','lowfreq'].includes(choice??'')&&(choice!==before.nextMonthChoice?.choice||after.nextMonthChoice?.agreedAt!==before.nextMonthChoice?.agreedAt);
 return start||expand||renewal||continuation?reason:null;
}
