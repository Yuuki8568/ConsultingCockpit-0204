import assert from "node:assert/strict";
import test from "node:test";
import { grossTaxBreakdown, invoiceTaxBreakdown, type ConsumptionTaxRate } from "../packages/web/src/web/domain/logic/tax";

test("confirmed gross amounts retain a complementary net/tax breakdown", () => {
  assert.deepEqual(grossTaxBreakdown(1100), { gross: 1100, taxRate: 10, net: 1000, tax: 100 });
  assert.deepEqual(grossTaxBreakdown(1080, 8), { gross: 1080, taxRate: 8, net: 1000, tax: 80 });
  assert.deepEqual(grossTaxBreakdown(0), { gross: 0, taxRate: 10, net: 0, tax: 0 });
  for (const rate of [8, 10] as const) {
    for (let gross = 0; gross < 1000; gross++) {
      const result = grossTaxBreakdown(gross, rate);
      assert.equal(result.net + result.tax, gross);
      assert.equal(result.tax, Number(BigInt(gross) * BigInt(rate) / BigInt(100 + rate)));
    }
  }
});

test("tax is floored once per invoice per rate, never per line", () => {
  const lines = [{ gross: 6, taxRate: 10 }, { gross: 6, taxRate: 10 }, { gross: 7, taxRate: 8 }, { gross: 7, taxRate: 8 }] as const;
  const invoice = invoiceTaxBreakdown(lines);
  assert.equal(lines.reduce((sum, line) => sum + grossTaxBreakdown(line.gross, line.taxRate).tax, 0), 0);
  assert.deepEqual(invoice, {
    gross: 26, net: 24, tax: 2,
    byRate: [{ gross: 14, taxRate: 8, net: 13, tax: 1 }, { gross: 12, taxRate: 10, net: 11, tax: 1 }],
  });
  assert.deepEqual(invoiceTaxBreakdown([...lines].reverse()), invoice);
});

test("empty invoice and explicit zero remain valid without fabricated charges", () => {
  assert.deepEqual(invoiceTaxBreakdown([]), { gross: 0, net: 0, tax: 0, byRate: [] });
  assert.deepEqual(invoiceTaxBreakdown([{ gross: 0, taxRate: 10 }]).byRate, [grossTaxBreakdown(0)]);
});

test("large exact integer inputs avoid floating point multiplication errors", () => {
  const gross = Number.MAX_SAFE_INTEGER;
  const result = grossTaxBreakdown(gross);
  assert.equal(result.tax, Number(BigInt(gross) * 10n / 110n));
  assert.equal(result.net + result.tax, gross);
  assert.equal(invoiceTaxBreakdown([{ gross, taxRate: 10 }]).gross, gross);
  assert.throws(() => invoiceTaxBreakdown([{ gross, taxRate: 10 }, { gross: 1, taxRate: 10 }]), RangeError);
  assert.throws(() => invoiceTaxBreakdown([{ gross, taxRate: 10 }, { gross: 1, taxRate: 8 }]), RangeError);
});

test("invalid amounts and unsupported rates are rejected rather than rounded or defaulted", () => {
  for (const amount of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, null, "110"]) {
    assert.throws(() => grossTaxBreakdown(amount as number), RangeError);
    assert.throws(() => invoiceTaxBreakdown([{ gross: amount as number, taxRate: 10 }]), RangeError);
  }
  for (const rate of [0, 5, 9, 10.1, NaN, Infinity, "10", null]) {
    assert.throws(() => grossTaxBreakdown(110, rate as ConsumptionTaxRate), RangeError);
    assert.throws(() => invoiceTaxBreakdown([{ gross: 110, taxRate: rate as ConsumptionTaxRate }]), RangeError);
  }
});
