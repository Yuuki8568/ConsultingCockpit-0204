/** Approved revisions are immutable; selecting latest never migrates stored cases. */
import { APPROVED_TERMS_VERSION as PREVIOUS_VERSION, APPROVED_TERMS_TEMPLATES as PREVIOUS_TEMPLATES } from './approved-terms';
export { PREVIOUS_VERSION, PREVIOUS_TEMPLATES };
export const APPROVED_TERMS_VERSION = '2026-10-24-approved-2';
function section(text: string, start: string, end: string, body: string) {
 const a=text.indexOf(start), b=text.indexOf(end,a+start.length);
 if(a<0||b<0) throw new Error(`Revision source changed: ${start}`);
 return text.slice(0,a)+start+'\n'+body+'\n\n'+text.slice(b);
}
function build() {
 const t={...PREVIOUS_TEMPLATES};
 for(const key of Object.keys(t) as (keyof typeof t)[]) t[key]=t[key].split(PREVIOUS_VERSION).join(APPROVED_TERMS_VERSION).split('改訂日：2026年10月23日').join('改訂日：2026年10月24日');
 t.nda=t.nda.replace('（本契約は、別途締結する「AI業務改善コンサルティング業務委託契約書」および「AI業務改善コンサルティングサービス 免責事項(第3版)」と一体として運用される。）','（本契約はNDA単独でも締結できる。業務委託契約書・免責事項を併用する場合は、実際に合意した文書のID・版・合意状態を本書に特定する。未締結・未合意の文書を適用済みと扱わない。）');
 const main=t.mainContract;
 const liability=main.slice(main.indexOf('第17条（損害賠償・責任の制限）')+'第17条（損害賠償・責任の制限）'.length,main.indexOf('第18条')).trim();
 t.nda=section(t.nda,'第8条（損害賠償）','第9条',liability+`\n弁護士費用は、現実に発生した直接かつ通常の損害に該当する範囲で賠償に含め、別枠とはせず、双方について本条の通常の賠償上限の内側に含める。故意・重大な過失、反社会的勢力の排除条項違反の場合の上記例外は変更しない。
本NDAの上限の適用関係：{{NDA上限適用関係}}。
主契約を締結した場合の参照先：{{NDA参照原契約}}。主契約が未締結の場合は、個別賠償上限の合意額・合意文書ID・合意日を確認するまで本NDAを確定しない。報酬未発生を理由とする0円の全面免責や最低額を自動設定しない。
個別上限の合意記録：{{NDA個別上限合意}}。`);
 t.nda=t.nda.split('{{賠償算定確認}}').join('{{NDA賠償算定確認}}').split('{{個別賠償上限合意}}').join('{{NDA個別上限合意}}');
 // A standalone NDA must not promise that an unexecuted main contract governs it.
 t.nda=t.nda.replace('賠償・管轄は主契約を参照し、付帯免責に異なる条件を重ねない。秘密保持義務違反の賠償にも主契約の通常の上限・損害範囲制限を適用し、','本NDAの賠償・管轄は第8条・第9条による。締結済み主契約を参照する場合は本書にID・版を明示し、未締結の主契約を合意済みと扱わない。秘密保持義務違反にも本書の通常の上限・損害範囲制限を適用し、');
 t.deliveryReceipt=t.deliveryReceipt.replace('納品日から14日以内に本検収書（合格または不合格の通知）が発行されない場合','成果物の納品を受けた日から14日以内に、甲から乙へ合格または不合格の通知が行われない場合');
 t.deliveryReceipt=t.deliveryReceipt.replace('【検収日】検収実施時記入','【検収日】{{実際の検収日}}');
 t.dpa=t.dpa.replace('{{契約開始日}}付にて締結した原契約','{{原契約締結日}}付にて締結した原契約（文書ID：{{原契約ID}}／版：{{原契約版}}）');
 t.dpa+='\n\n【実施状況の確認】上記安全管理措置・越境移転条件は義務・条件を記載したものであり、設定済み・移転なし等の実施証明ではない。契約前に案件別の適用、実施状況および確認証跡を記録する。\n{{DPA実施確認}}';
 t.completionReport=section(t.completionReport,'6. 委託料の計算','7. 別添資料','実際の実施記録・合意済み明細に基づく税込精算額、税率別内訳、実費・前受金・返金等の処理：{{完了精算確認}}\n見積額を実績・精算額として自動転記しない。');
 t.completionReport=section(t.completionReport,'8. AI利用状況報告（AI特約に基づく報告）','━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━','実際に利用したサービス・プラン、入力範囲、設定確認日・確認者・結果、インシデントの有無と対応（不使用の場合はその実確認）：{{完了AI確認}}');
 t.completionReport=t.completionReport.replace('業務完了の確認：［要確認：対象業務・完了日・確認者・結果］','業務完了の確認：{{実際の完了確認}}');
 return Object.freeze(t);
}
export const APPROVED_TERMS_TEMPLATES=build();
export function isApprovedVersion(version?: string) { return version===PREVIOUS_VERSION||version===APPROVED_TERMS_VERSION; }
export function templatesForVersion(version?: string) { return version===APPROVED_TERMS_VERSION?APPROVED_TERMS_TEMPLATES:version===PREVIOUS_VERSION?PREVIOUS_TEMPLATES:undefined; }
