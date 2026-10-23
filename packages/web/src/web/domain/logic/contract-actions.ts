import type { CaseRecord } from '../types';
import { APPROVED_TERMS_VERSION } from '../data/approved-terms';
import { monthlyRenewalDates } from './renewal';

/** Only manually verified facts; no status is inferred from viewing a reminder. */
export interface ContractActionEvidence {
  acceptance?: { active: boolean; receivedOn?: string; completedOn?: string };
  refund?: { active: boolean; amountFixedOn?: string; completedOn?: string };
  deletion?: { active: boolean; agreedDueOn?: string; completedOn?: string };
  /** Renewal period for which issuing the invoice was actually verified. */
  renewalInvoiceFor?: string;
  /** Manually reconciled all past renewal invoices through this renewal date. */
  renewalReconciledThrough?: string;
}
export type ContractActionTarget = 'conditions' | 'payment' | 'support' | 'evidence';
export interface ContractAction {
  id: string;
  title: string;
  detail: string;
  target: ContractActionTarget;
  urgency: 'input' | 'due' | 'overdue' | 'upcoming' | 'info';
  dueOn?: string;
}
const DAY = 86400000;
export function verifiedCalendarDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const n = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value ? value : null;
}
export function contractTodayJst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
export function contractActionPopupEligible(a: ContractAction): boolean {
  return a.urgency === 'input' || a.urgency === 'due' || a.urgency === 'overdue';
}
/** One automatic popup per case per browser session, even after edits/remounts. */
export function claimContractActionPopup(caseId: string, actions: readonly ContractAction[], seen: Set<string>): boolean {
  if (seen.has(caseId) || !actions.some(contractActionPopupEligible)) return false;
  seen.add(caseId);
  return true;
}

/** Read-only calculation. Never migrates contracts, issues invoices or completes tasks. */
export function contractActions(c: CaseRecord, missingFacts: readonly string[], evidence: ContractActionEvidence = {}, today = contractTodayJst()): ContractAction[] {
  if (!verifiedCalendarDate(today)) throw new Error('日本時間の有効な基準日が必要です');
  if (c.contractTemplateVersion !== APPROVED_TERMS_VERSION) return [{ id: 'legacy', title: '保存済みの契約条件を確認', detail: 'この案件には新版の期限を当てはめません。締結済みの条件・期限を個別に確認してください。', target: 'conditions', urgency: 'info' }];
  const actions: ContractAction[] = [];
  const addDue = (id: string, title: string, detail: string, target: ContractActionTarget, date: string) => {
    const urgency = date < today ? 'overdue' : date <= shift(today, 3) ? 'due' : 'upcoming';
    actions.push({ id, title, detail, target, dueOn: date, urgency });
  };
  const active = c.status !== 'done' && c.status !== 'lost';
  if (active && missingFacts.length) actions.push({ id: 'conditions', title: '契約の必須条件を確認', detail: missingFacts.join('／'), target: 'conditions', urgency: 'input' });
  if (active && !(c.invoice.paidFlag && verifiedCalendarDate(c.invoice.paidAt) && c.invoice.paidAt <= today)) {
    actions.push({ id: 'payment', title: '着手前の入金確認', detail: '入金済みの確認と実入金日が揃っていません。有料業務は入金確認後、開始日を合意・通知してから着手します。', target: 'payment', urgency: 'input' });
  }
  if (active && (c.support?.contract.autoRenew === '1m' || c.execution?.contractType === 'monthly')) {
    const supportStart = c.support?.contract.startDate ?? '';
    const executionStart = c.execution?.contractStart ?? '';
    const dates = supportStart && executionStart && supportStart !== executionStart ? null : monthlyRenewalDates(supportStart || executionStart, today);
    if (!dates) actions.push({ id: 'renewal-date', title: '月額契約の開始日を確認', detail: '開始日が未確認または実行管理と月額設定で不一致のため、更新・請求・停止期限を計算しません。', target: 'support', urgency: 'input' });
    else {
      const monthStart = `${today.slice(0, 7)}-01`;
      let prior = monthlyRenewalDates(supportStart || executionStart, monthStart);
      if (prior && prior.renewalDate >= today) {
        const previousMonth = new Date(`${monthStart}T00:00:00Z`);
        previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
        prior = monthlyRenewalDates(supportStart || executionStart, previousMonth.toISOString().slice(0, 10));
      }
      if (prior && prior.renewalDate < today && (!verifiedCalendarDate(evidence.renewalReconciledThrough) || evidence.renewalReconciledThrough! < prior.renewalDate || evidence.renewalReconciledThrough! > today)) {
        actions.push({ id: 'renewal-history', title: '過去の更新分の未処理を照合', detail: `${prior.renewalDate} 更新分までの発行・取消・精算を照合してください。次回更新への切替は、過去分の処理完了を意味しません。照合済みの最終更新日を対応日付に記録します。`, target: 'evidence', urgency: 'input' });
      }
      if (evidence.renewalInvoiceFor !== dates.renewalDate) addDue(`renewal-invoice:${dates.renewalDate}`, '更新分の請求発行を確認', `更新日 ${dates.renewalDate} の14日前が発行日。実際に発行したことを確認して記録してください。遅延発行時は発行から14日の支払猶予と日程再合意を確認します。`, 'support', dates.invoiceDate);
      addDue(`renewal-stop:${dates.renewalDate}`, '更新停止の連絡・到達を確認', `停止期限は ${dates.stopDeadlineJst}。指定連絡先への到達記録を確認。未入金請求の取消や前払分の返金は個別に確認し、自動処理しません。`, 'support', shift(dates.renewalDate, -1));
    }
  }
  const dated = [
    { key: 'acceptance', record: evidence.acceptance, basis: evidence.acceptance?.receivedOn, days: 14, title: '検収・確認への対応', missing: '確認済みの受領日', detail: '確認済み受領日から14日。合意した検収基準と異議の有無を確認します。期限経過だけで検収完了にはしません。' },
    { key: 'refund', record: evidence.refund, basis: evidence.refund?.amountFixedOn, days: 14, title: '返金手続を確認', missing: '返金額の確定日', detail: '返金額確定から14日以内。振込先・金額を確認し、事務所負担の手数料で手続してください。自動送金は行いません。' },
    { key: 'deletion', record: evidence.deletion, basis: evidence.deletion?.agreedDueOn, days: 0, title: '返却・削除への対応', missing: '個別に合意した返却・削除期限', detail: '合意済み期限を確認。法定保存資料と原データを区別し、バックアップ残存分も含めて対応記録を残します。自動削除は行いません。' },
  ];
  for (const item of dated) {
    if (!item.record?.active) continue;
    const date = verifiedCalendarDate(item.basis);
    const completed = verifiedCalendarDate(item.record.completedOn);
    if (completed && date && completed <= today && (item.key === 'deletion' || completed >= date)) continue;
    if (item.record.completedOn) {
      actions.push({ id: `${item.key}-completion`, title: `${item.title}：完了記録を再確認`, detail: '完了日が未来・不正、または基準日との前後関係を確認できません。完了とは扱いません。', target: 'evidence', urgency: 'input' });
    }
    if (!date || (item.days > 0 && date > today)) actions.push({ id: item.key, title: `${item.title}：日付の入力が必要`, detail: `${item.missing}が未確認です。仮の期限は設定しません。`, target: 'evidence', urgency: 'input' });
    else addDue(item.key, item.title, item.detail, 'evidence', shift(date, item.days));
  }
  const rank = { overdue: 0, input: 1, due: 2, upcoming: 3, info: 4 };
  return actions.sort((a, b) => rank[a.urgency] - rank[b.urgency] || (a.dueOn ?? '').localeCompare(b.dueOn ?? '') || a.id.localeCompare(b.id));
}
