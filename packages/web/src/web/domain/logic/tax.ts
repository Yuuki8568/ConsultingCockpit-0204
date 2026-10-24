/** 確認済みの税込・円単位の金額のみを受け取る。既存の税抜額を変換する関数ではない。 */
export type ConsumptionTaxRate = 8 | 10;

export interface GrossTaxAmount {
  gross: number;
  taxRate: ConsumptionTaxRate;
}

export interface TaxBreakdown extends GrossTaxAmount {
  net: number;
  tax: number;
}

const MAX_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);

function validatedAmount(amount: number): bigint {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError("税込金額は0以上の安全な整数（円単位）で指定してください。");
  }
  return BigInt(amount);
}

function validatedRate(rate: ConsumptionTaxRate): bigint {
  if (rate !== 8 && rate !== 10) throw new RangeError("対応税率は8%または10%です。");
  return BigInt(rate);
}

function safeAmount(amount: bigint): number {
  if (amount > MAX_AMOUNT) throw new RangeError("金額合計が安全な整数の上限を超えています。");
  return Number(amount);
}

/** 税率別の税込合計から内税を1回だけ切り捨て、税抜額は差額で求める。 */
export function grossTaxBreakdown(gross: number, taxRate: ConsumptionTaxRate = 10): TaxBreakdown {
  const amount = validatedAmount(gross);
  const rate = validatedRate(taxRate);
  const tax = amount * rate / (100n + rate);
  return { gross, taxRate, tax: Number(tax), net: Number(amount - tax) };
}

/** 1請求書に含まれる全明細を渡す。行別丸めせず、税率別に合算した後で1回処理する。 */
export function invoiceTaxBreakdown(lines: readonly GrossTaxAmount[]): {
  gross: number;
  net: number;
  tax: number;
  byRate: TaxBreakdown[];
} {
  const sums = new Map<ConsumptionTaxRate, bigint>();
  for (const line of lines) {
    const amount = validatedAmount(line.gross);
    validatedRate(line.taxRate);
    sums.set(line.taxRate, (sums.get(line.taxRate) ?? 0n) + amount);
  }
  const byRate = [...sums.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, gross]) => grossTaxBreakdown(safeAmount(gross), rate));
  const gross = safeAmount(byRate.reduce((total, row) => total + BigInt(row.gross), 0n));
  const tax = safeAmount(byRate.reduce((total, row) => total + BigInt(row.tax), 0n));
  return { gross, net: gross - tax, tax, byRate };
}
