export interface MonthlyRenewalDates {
  renewalDate: string;
  invoiceDate: string;
  stopDeadlineJst: string;
}

function parseDate(value: string): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 日付だけをUTCで計算。月末補正後も当初の応当日へ戻す（前回更新日の加算ではない）。 */
function anniversary(start: Date, monthOffset: number): Date {
  const first = new Date(start);
  first.setUTCDate(1);
  first.setUTCMonth(first.getUTCMonth() + monthOffset);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  first.setUTCDate(Math.min(start.getUTCDate(), last.getUTCDate()));
  return first;
}

/**
 * 月額契約の次回更新候補。初回更新は開始日の1か月後、今日当日の更新を含む。
 * 入金・契約成立・請求発行を推定せず、期限到来を自動処理しない。
 */
export function monthlyRenewalDates(startISO: string, todayISO: string): MonthlyRenewalDates | null {
  const start = parseDate(startISO);
  const today = parseDate(todayISO);
  if (!start || !today) return null;
  let offset = Math.max(1, (today.getUTCFullYear() - start.getUTCFullYear()) * 12 + today.getUTCMonth() - start.getUTCMonth());
  let renewal = anniversary(start, offset);
  if (renewal.getTime() < today.getTime()) renewal = anniversary(start, ++offset);
  // The API deliberately supports only four-digit ISO calendar years.
  if (renewal.getUTCFullYear() > 9999) return null;
  const invoice = new Date(renewal);
  invoice.setUTCDate(invoice.getUTCDate() - 14);
  const stop = new Date(renewal);
  stop.setUTCDate(stop.getUTCDate() - 1);
  return {
    renewalDate: iso(renewal),
    invoiceDate: iso(invoice),
    stopDeadlineJst: `${iso(stop)} 23:59（日本時間）`,
  };
}
