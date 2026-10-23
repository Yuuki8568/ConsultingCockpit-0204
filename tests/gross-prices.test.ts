import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legacyNetToGross, grossToLegacyNet, calculatePricing, generateTalk } from '../packages/web/src/web/domain/logic/pricing';
import { SERVICE_MENU_ITEMS, buildMenuProposalText } from '../packages/web/src/web/domain/data/service-menu';
import { PRICING_PRESETS, STAGE_PRICE_RANGE, GARTNER_DEFS } from '../packages/web/src/web/domain/data/diagnosis-legal';
import type { PricingInputs } from '../packages/web/src/web/domain/types';

test('published menu prices preserve economic total and explicitly include VAT', () => {
  const original = [[30000,30000],[50000,80000],[200000,200000],[150000,180000],[550000,600000],[80000,100000],[150000,250000]];
  SERVICE_MENU_ITEMS.forEach((item, i) => {
    assert.equal(item.priceLo, original[i]![0]! * 11 / 10);
    assert.equal(item.priceHi, original[i]![1]! * 11 / 10);
    assert.match(item.priceNote, /税込/);
    assert.doesNotMatch(item.priceNote, /税抜/);
  });
  assert.match(SERVICE_MENU_ITEMS[0]!.priceNote, /33,000/);
  assert.match(GARTNER_DEFS.Defend.price, /5.5万円/);
  assert.match(GARTNER_DEFS.Extend.price, /16.5万円/);
  assert.match(buildMenuProposalText({ industry:'general', size:'small', stage:'Defend', aiLeader:'none', keywords:'', knownInfo:'' }, SERVICE_MENU_ITEMS[0]), /33,000（税込）/);
});

test('gross editing roundtrips integer yen without rounding stored legacy net', () => {
  for (const gross of [0,1,5,10,11,101,33000,165001,9999999]) {
    assert.equal(legacyNetToGross(grossToLegacyNet(gross)), gross);
  }
  assert.equal(legacyNetToGross(30000), 33000);
  assert.equal(legacyNetToGross(150000), 165000);
  assert.equal(legacyNetToGross(0), 0);
});

test('existing pricing model and preset storage stay net; generated pitch is gross', () => {
  const inputs = { ...PRICING_PRESETS.spot, projectTitle:'合成案件', domains:1, competitor:0 } as PricingInputs;
  const before = JSON.stringify(inputs);
  const result = calculatePricing(inputs);
  assert.equal(result.base, 30000);
  assert.equal(inputs.baseline, 15000);
  assert.equal(STAGE_PRICE_RANGE.Defend.std, 50000);
  const talk = generateTalk(inputs, result);
  assert.match(talk, new RegExp(legacyNetToGross(result.recommended).toLocaleString('ja-JP')));
  assert.match(talk, /税込/);
  assert.doesNotMatch(talk, /税抜/);
  assert.equal(JSON.stringify(inputs), before);
});

test('gross UI boundary applies exactly once and legacy support terms remain isolated', () => {
  const root = 'packages/web/src/web/';
  const pricing = readFileSync(root+'pages/case/pricing.tsx','utf8');
  assert.match(pricing, /value=\{legacyNetToGross\(inputs.baseline\)\}/);
  assert.match(pricing, /i.baseline = grossToLegacyNet\(v\)/);
  assert.match(pricing, /x.estimate.totalIncTax = legacyNetToGross\(result.recommended\)/);
  assert.doesNotMatch(pricing, /税抜です。請求時/);
  const support = readFileSync(root+'pages/case/support.tsx','utf8');
  assert.match(support, /!s.contract.endDate && !c.contractTemplateVersion/);
  assert.match(support, /noticeDays: newTerms \? 1 : 30/);
  assert.match(support, /value=\{legacyNetToGross\(sp.contract.monthlyFee\)\}/);
  assert.match(support, /s.contract.monthlyFee = grossToLegacyNet\(v\)/);
  const exports = readFileSync(root+'lib/export/case-export.ts','utf8');
  assert.match(exports, /金額（税込）/);
  assert.match(exports, /legacyNetToGross\(pr.recommended\)/);
});


test('legacy report fee is never silently relabelled or carried forward as gross', () => {
  const report = readFileSync('packages/web/src/web/pages/case/report.tsx', 'utf8');
  assert.match(report, /last\?\.consultFeeTaxBasis === "gross" \? last.consultFee : supportMonthlyFee/);
  assert.match(report, /保存額（税区分未確認）/);
  assert.match(report, /consultFeeTaxBasis: "gross"/);
  assert.match(report, /x.reports\[idx\].consultFeeTaxBasis = "gross"/);
});
