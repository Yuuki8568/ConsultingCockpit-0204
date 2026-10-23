import type { CaseRecord, ContractFacts } from '../types';
export const CONTRACT_FACT_FIELDS = [
  ['legalApplicability','当事者属性・継続履歴・法定予告等の適用確認と処理'],
  ['documentVersions','関連文書の版・改訂日・ID・合意状態（本書のみの場合はその旨、未署名を合意済としない）'],
  ['noticeDestination','通知先（電子メール等の指定先）'],
  ['noticeMethod','通知方法・到達確認・不達時の代替手段'],
  ['scopeAndDeliverables','作業・対象外・成果物・仕様・納期・支援枠'],
  ['acceptanceAndCompletion','検収・完了条件、説明・問合せ・是正/追加変更・保守'],
  ['pricingAndExpenses','税込明細、固定/時間料金、計測・丸め・上限・超過承認・前受差額、事前実費の費目/負担上限'],
  ['informationManagement','情報管理票：種類/目的、実保存基盤、Drive副保存/権限、端末コピー・閲覧者・委託先'],
  ['retentionDeletion','証憑/預かりデータの区分、保存根拠/期間、返還削除方法/期限、バックアップ周期・残存保護'],
  ['aiServiceRecord','案件別AI事業者・サービス/プラン、入力情報/加工、学習・保持条件、越境移転対応'],
  ['aiConsentEvidence','未加工入力の事前書面承諾の文書ID・日付・許容範囲'],
  ['aiProtectionEvidence','未加工入力の保護措置を実確認した設定・規約・証跡'],
  ['liabilityAssessment','事由単位・基準日・暦上3か月・税込実入金/実費/返金・契約別区分の算定確認'],
  ['individualCapAgreement','入金0円/可能性ありの場合の個別賠償上限の合意額・文書ID・日付'],
] as const;
const label = Object.fromEntries(CONTRACT_FACT_FIELDS) as Record<string,string>;
const base = ['legalApplicability','documentVersions','noticeDestination','noticeMethod','informationManagement','retentionDeletion'] as const;
/** A〜Dの承認は案件事実の確認の代わりにしない。NDA単独には報酬・成果物を要求しない。 */
export function missingContractFacts(c: CaseRecord, docType = 'mainContract'): string[] {
  const f = c.contractFacts ?? {};
  const infoOnly = ['nda','dpa','aiAddendum'].includes(docType);
  const keys: (keyof ContractFacts)[] = [...base];
  if (!infoOnly) keys.push('scopeAndDeliverables','acceptanceAndCompletion','pricingAndExpenses','liabilityAssessment');
  const missing = keys.filter(k => !f[k]?.trim()).map(k => label[k] ?? k);
  if (f.transactionPurpose !== 'business') missing.push('取引目的：事業目的のB2Bであること（生活目的の個人取引にこの版を適用しない）');
  if (!['none','processed','unprocessed'].includes(f.aiUse ?? '')) missing.push('AI利用区分');
  if (f.aiUse === 'processed' || f.aiUse === 'unprocessed') {
    if (!f.aiServiceRecord?.trim()) missing.push(label.aiServiceRecord!);
  }
  if (f.aiUse === 'unprocessed') {
    for (const k of ['aiConsentEvidence','aiProtectionEvidence'] as const) if (!f[k]?.trim()) missing.push(label[k]!);
  }
  if (!infoOnly) {
    if (!['nonzero','zero_or_possible'].includes(f.zeroLiability ?? '')) missing.push('実入金0円となる場合の確認');
    if (f.zeroLiability === 'zero_or_possible' && !f.individualCapAgreement?.trim()) missing.push(label.individualCapAgreement!);
  }
  if (docType === 'purchaseOrder') {
    const date = f.orderReceivedOn ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) missing.push('確認済みの発注日');
  }
  return missing;
}

export function contractFactsContext(c: CaseRecord): Record<string,string> {
 const f = c.contractFacts ?? {};
 const unused = f.aiUse === 'none';
 return {
  '法令適用確認':f.legalApplicability ?? '', '合意文書一覧':f.documentVersions ?? '',
  '発注日':f.orderReceivedOn ?? '',
  '通知先':f.noticeDestination ?? '', '通知方法':f.noticeMethod ?? '',
  '業務成果物条件':f.scopeAndDeliverables ?? '', '検収完了条件':f.acceptanceAndCompletion ?? '',
  '料金実費条件':f.pricingAndExpenses ?? '', '情報管理票':f.informationManagement ?? '',
  '返還削除条件':f.retentionDeletion ?? '',
  'AI利用区分':({none:'本案件ではAIを使用しない',processed:'加工後の情報のみ使用',unprocessed:'事前書面承諾・実確認した保護措置の範囲に限定'} as Record<string,string>)[f.aiUse ?? ''] ?? '',
  'AI利用記録':unused?'不使用（案件確認）':f.aiServiceRecord ?? '',
  'AI承諾証跡':f.aiUse === 'unprocessed' ? f.aiConsentEvidence ?? '' : f.aiUse ? '未加工入力を許容しないため該当なし' : '',
  'AI保護措置':f.aiUse === 'unprocessed' ? f.aiProtectionEvidence ?? '' : f.aiUse ? '未加工入力を許容しないため該当なし' : '',
  '賠償算定確認':f.liabilityAssessment ?? '',
  '個別賠償上限合意':f.zeroLiability === 'nonzero' && f.liabilityAssessment?.trim() ? '対象期間の実入金0円に該当しないことを案件確認。0円となる場合は個別合意まで確定停止。' : f.individualCapAgreement ?? '',
 };
}
