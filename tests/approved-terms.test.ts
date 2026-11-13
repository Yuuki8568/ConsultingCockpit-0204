import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_TEMPLATES } from '../packages/web/src/web/domain/data/doc-templates';
import { APPROVED_TERMS_TEMPLATES as templates, APPROVED_TERMS_PENDING as pending, APPROVED_TERMS_VERSION } from '../packages/web/src/web/domain/data/approved-terms';

test('versioned templates preserve original templates and replace contradictory commercial defaults', () => {
  assert.match(BUILT_IN_TEMPLATES.mainContract, /までの6ヶ月間/);
  assert.match(BUILT_IN_TEMPLATES.mainContract, /直近12ヶ月間/);
  for (const body of Object.values(templates)) {
    assert.ok(body.includes(APPROVED_TERMS_VERSION));
    assert.doesNotMatch(body, /受領後7日以内|受領した日から7日以内|直近12ヶ月|までの6ヶ月間|さらに3ヶ月間|消費税別|円（税抜）|東京地方裁判所/);
  }
});
test('prepayment renewal cancellation and bilateral gross liability directions are present', () => {
  for (const key of ['mainContract', 'monthlySupportContract'] as const) {
    const body = templates[key];
    for (const text of ['前日23:59（日本時間）', '当初の応当日', '更新日の14日前', '請求書発行日から14日以内', '返金額確定後14日以内', '実際に発生した実費', '甲の都合', '双方に適用', '実支払税込報酬総額', '秘密保持義務違反']) assert.ok(body.includes(text), `${key}: ${text}`);
  }
});
test('approved global terms have only factual per-case fields remaining', () => {
  for (const key of ['mainContract', 'monthlySupportContract', 'disclaimer', 'nda', 'aiAddendum', 'dpa', 'estimate', 'purchaseOrder'] as const) assert.ok(pending[key].length > 0, key);
  assert.ok(pending.mainContract.some((s) => s.includes('賠償算定確認')));
  assert.ok(pending.dpa.some((s) => s.includes('返還削除条件')));
  assert.match(templates.mainContract, /第三者ライセンス/);
  for (const text of Object.values(templates)) assert.doesNotMatch(text, /\[要承認:|\[要確認:/);
});
test('AI and retained IP reflect limited approved exceptions, B2B jurisdiction unified', () => {
  assert.match(templates.aiAddendum, /事前の書面承諾/);
  assert.match(templates.aiAddendum, /対象AIサービスおよびプラン/);
  assert.match(templates.aiAddendum, /基本保存先はCockpit、副保存先はGoogleドライブ/);
  assert.match(templates.mainContract, /契約終了後も継続利用し、改変し、守秘義務を負う保守委託先と共有/);
  assert.match(templates.mainContract, /再販は認めない/);
  for (const key of ['mainContract', 'nda', 'disclaimer', 'monthlySupportContract'] as const) assert.match(templates[key], /福島地方裁判所白河支部または白河簡易裁判所/);
});
test('gross prices retain separately labelled net and tax breakdown, once-per-rate rounding', () => {
  assert.match(templates.estimate, /合意済み税込料金明細/);
  assert.match(templates.estimate, /税抜内訳/);
  assert.match(templates.estimate, /消費税（10%）/);
  assert.match(templates.estimate, /税率ごとの税込対価を合計して1回/);
  assert.doesNotMatch(templates.mainContract, /消費税相当額を加算して支払う/);
});

test('gross row arithmetic headings and deferred operational terms remain coherent', () => {
  assert.match(templates.estimate, /合意済み税込料金明細：{{料金実費条件}}/);
  assert.match(templates.completionReport, /税抜内訳\t\t{{税抜金額}}円/);
  assert.doesNotMatch(templates.dpa, /バックアップを含む。.*確実な削除/);
  assert.doesNotMatch(templates.mainContract, /稼働時間は15分単位/);
  assert.match(templates.referralLetter, /¥55,000〜・税込/);
  assert.match(templates.referralLetter, /月¥165,000〜・税込/);
});

test('A-D supplements are implemented without inferring case facts', () => {
  assert.equal(APPROVED_TERMS_VERSION, '2026-10-23-approved-1');
  for (const phrase of ['到達した時点', '返信遅れだけ', '発行日から14日の支払期間', '未提供期間の料金を重複計上しない', '30日前まで', '実費および基準日までに返金済み', '最初の原因事由', '暦上の3か月間', '契約全体で異なる原因', '個別上限を合意するまで', '引渡し時に開始', '当該成果物の対価として合意した金額の全額']) assert.ok(templates.mainContract.includes(phrase), phrase);
  assert.match(templates.nda, /相談終了を書面通知した日/);
  assert.match(templates.nda, /終了後3年間存続/);
  assert.match(templates.nda, /保有期間中、秘密保持義務を継続/);
  assert.match(templates.dpa, /品質改善等への二次利用/);
  assert.match(templates.aiAddendum, /未確認のサービス・設定・データ範囲では行わない/);
  assert.match(templates.mainContract, /新しい公開版に自動置換しない/);
  assert.match(templates.mainContract, /{{通知先}}/);
  assert.match(templates.dpa, /{{情報管理票}}/);
});

test('pre-sign and non-hourly first-send paths do not require fabricated dates or delivered items', () => {
  assert.doesNotMatch(templates.mainContract, /{{成果物リスト}}|{{月額固定報酬}}|{{スポット時間単価}}|{{契約締結日}}/);
  assert.doesNotMatch(templates.estimate, /{{月額固定報酬}}|{{スポット時間単価}}/);
  assert.match(templates.deliveryReceipt, /{{成果物リスト}}/);
});

test('Q28 option 1 keeps ordinary confidentiality inside bilateral cap and direct-normal scope',()=>{
 for(const key of ['mainContract','monthlySupportContract','disclaimer'] as const){
  const t=templates[key];
  assert.ok(t.includes('現実に発生した直接かつ通常の損害'));
  assert.ok(t.includes('故意または重大な過失、反社会的勢力の排除条項違反に基づく損害賠償には、賠償上限および損害範囲の制限を適用しない'));
  assert.ok(t.includes('故意または重大な過失によらない秘密保持義務違反にも、反社会的勢力の排除条項違反に該当しない限り、双方について上記の通常の賠償上限および直接かつ通常の損害に限る範囲制限を適用する'));
  assert.ok(t.includes('秘密保持義務違反だけを理由に、これらの制限を外さない'));
 }
 for(const [key,t] of Object.entries(templates)) {
  assert.doesNotMatch(t, /故意[、・または重大な過失]*、秘密保持義務違反、反社会的勢力/,key);
  assert.ok(!t.includes('主契約の秘密保持違反に関する例外'),key);
 }
 for(const key of ['mainContract','monthlySupportContract','disclaimer','nda','dpa','aiAddendum','estimate','purchaseOrder'] as const)
  assert.ok(templates[key].includes('秘密保持義務違反の賠償にも主契約の通常の上限・損害範囲制限を適用'),key);
});

test('AI survival references a real numbered cross-border obligation and never floating latest terms',()=>{
 assert.ok(templates.aiAddendum.includes('第3条第2項'));
 assert.ok(templates.aiAddendum.includes('2. 前項の入力した個人情報が外国にある第三者'));
 assert.ok(!templates.aiAddendum.includes('免責事項（最新版）'));
 assert.ok(templates.aiAddendum.includes('合意文書一覧に記録した版の免責事項'));
});

test('ancillary AI/data/IP/service clauses do not reintroduce independent blanket immunity',()=>{
 assert.ok(!templates.disclaimer.includes('乙は責任を負わない。ただし'));
 assert.ok(!templates.disclaimer.includes('乙は当該影響について責任を負わない'));
 assert.ok(templates.disclaimer.includes('本書独自の免責を重ねない'));
 assert.ok(templates.disclaimer.includes('合意した提供義務および契約不適合への対応義務は免除しない'));
});
