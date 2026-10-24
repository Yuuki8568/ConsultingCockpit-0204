import type { CaseRecord } from '../types';
import { isApprovedVersion, APPROVED_TERMS_VERSION } from '../data/contract-revisions';

/** 新規案件にのみ明示採用。既存・送付済み・締結済み・生成済み案件は移行しない。 */
export function selectNewContractVersion(c: CaseRecord): string | null {
  if (c.contractTemplateVersion === APPROVED_TERMS_VERSION) return null;
  if (c.support || c.fde?.priceStatus === 'agreed' || c.execution?.contractStart || c.execution?.contractEnd) return '既存のサポート設定・合意額・契約期間があります。既存合意と新版の差異を確認するまで適用できません。';
  if (c.contractTemplateVersion || c.generatedDocs.length || Object.values(c.legalDocs).some((d) => d.docNo || d.signedAt || d.status === 'sent' || d.status === 'signed')) {
    return '既存書類・合意のある案件には新版を適用しません。変更契約の扱いを別途確認してください。';
  }
  c.contractTemplateVersion = APPROVED_TERMS_VERSION;
  return null;
}

/** 旧レビュー版の保存制限を保持するための理由。承認版の生成には使用しない。 */
export const PENDING_CONTRACT_RELEASE = '未承認の重要条件が残る契約版です。正式出力・送付・締結を停止しています。';

/** Legacy saved documents stay readable; new generation requires a selected approved revision. */
export function contractGenerationBlock(c: CaseRecord): string | null {
 return isApprovedVersion(c.contractTemplateVersion) ? null : '新規生成には承認済み契約版の明示選択が必要です。旧版の保存済み書類は変更せず、新規案件または確認用TESTコピーで準備してください。';
}
