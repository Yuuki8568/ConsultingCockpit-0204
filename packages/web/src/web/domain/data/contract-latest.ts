/** Revision 3. Earlier modules and previously agreed documents remain immutable. */
import { APPROVED_TERMS_VERSION as REVISION_2, APPROVED_TERMS_TEMPLATES as REVISION_2_TEMPLATES, isApprovedVersion as isEarlierApproved, templatesForVersion as earlierTemplates } from './contract-revisions';
import { SERVICE_SCOPE_NOTICE, ADMINISTRATIVE_SCRIVENER_EXPLANATION } from './service-scope';
export const APPROVED_TERMS_VERSION = '2026-10-24-approved-3';
export { REVISION_2 };
function replaceSection(text:string,start:string,end:string,body:string) {
 const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
 if(a<0||b<0) throw new Error(`Frozen revision source changed: ${start}`);
 return text.slice(0,a)+start+'\n'+body+'\n\n'+text.slice(b);
}
function build() {
 const t={...REVISION_2_TEMPLATES};
 for(const k of Object.keys(t) as (keyof typeof t)[]) t[k]=t[k].split(REVISION_2).join(APPROVED_TERMS_VERSION);
 t.disclaimer=replaceSection(t.disclaimer,'第7条（法務・税務・医療等専門領域に関する助言の除外）','第8条',`本サービスにおいて、乙は、弁護士法第72条に定める法律事件に関する具体的な法律事務、税理士法第52条に定める税務代理・税務書類作成・税務相談、医師法に定める医療行為・医学的診断、社会保険労務士法その他の法令により有資格者に独占される業務を行わない。
【当事務所の提供範囲】
${SERVICE_SCOPE_NOTICE}
【法令の説明】
${ADMINISTRATIVE_SCRIVENER_EXPLANATION}
上記の事務所としての受託対象外の範囲と、個別行為の法的評価は区別する。一般的な制度情報の提供や通常の業務改善が、補助金に言及したことだけで禁止されるとの説明ではない。書類への助言・添削も、その実質が申請書類の作成代行・代筆となる場合は受託しない。`);
 t.mainContract=replaceSection(t.mainContract,'第2条の2（補助金等に関する業務の範囲）','第3条',`${SERVICE_SCOPE_NOTICE}
乙は一般的な制度情報の提供および通常の業務改善支援に限り、関係法令と合意した範囲内で行う。助言・添削の名目でも、実質的な申請書類・申請用事業計画書の作成代行・代筆は含めない。必要な相談先は制度・業務に応じた適切な有資格専門家とし、紹介に関して乙は報酬を収受しない。未確認の提携関係や依頼の受任を保証しない。`);
 t.disclaimer=t.disclaimer.replace('改正行政書士法第19条に基づく業務除外を追加（第7条）','行政書士法第19条の要件・例外と事務所の受託対象外を区別（第7条）');
 t.mainContract+='\n\n【受託範囲の事前確認】\n依頼内容：{{依頼業務概要}}\n業務区分：{{受託業務区分}}\n担当者・確認日・適用法令/資格要件・対象外の切り分け・確認先等：{{受託範囲確認記録}}';
 return Object.freeze(t);
}
export const APPROVED_TERMS_TEMPLATES=build();
export function isApprovedVersion(v?:string) { return v===APPROVED_TERMS_VERSION||isEarlierApproved(v); }
export function hasRevisedContractFacts(v?:string) { return v===REVISION_2||v===APPROVED_TERMS_VERSION; }
export function templatesForVersion(v?:string) { return v===APPROVED_TERMS_VERSION?APPROVED_TERMS_TEMPLATES:earlierTemplates(v); }
