import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeEmptyCase } from '../packages/web/src/web/domain/logic/state';
import { APPROVED_TERMS_VERSION } from '../packages/web/src/web/domain/data/approved-terms';
import { contractActions, contractTodayJst, verifiedCalendarDate, claimContractActionPopup } from '../packages/web/src/web/domain/logic/contract-actions';
import type { Support } from '../packages/web/src/web/domain/types';
const fresh = () => {
  const c = makeEmptyCase('SYNTHETIC ACTION TEST');
  c.contractTemplateVersion = APPROVED_TERMS_VERSION;
  c.invoice.paidFlag = true;
  c.invoice.paidAt = '2026-10-01';
  return c;
};
test('JST day boundary and invalid calendar dates are exact', () => {
  assert.equal(contractTodayJst(new Date('2026-10-22T14:59:59Z')), '2026-10-22');
  assert.equal(contractTodayJst(new Date('2026-10-22T15:00:00Z')), '2026-10-23');
  for (const d of ['', '2026-02-30', '2026-10-23T00:00:00Z']) assert.equal(verifiedCalendarDate(d), null);
});
test('legacy signed contracts never receive new terms or mutation', () => {
  const c = fresh(); delete c.contractTemplateVersion;
  c.legalDocs.mainContract = {status:'signed', signedAt:'2026-10-01', docNo:'signed-1'};
  const before = JSON.stringify(c);
  const result = contractActions(c, ['missing'], {refund:{active:true,amountFixedOn:'2026-10-01'}}, '2026-10-23');
  assert.deepEqual(result.map(a=>a.id), ['legacy']);
  assert.equal(result[0].urgency, 'info');
  assert.equal(JSON.stringify(c), before);
});
test('missing conditions and payment evidence prompt without inventing due dates', () => {
  const c = fresh(); c.invoice.paidAt = '';
  const result = contractActions(c, ['範囲', '通知先'], {}, '2026-10-23');
  assert.deepEqual(result.map(a=>a.id), ['conditions','payment']);
  assert.ok(result.every(a=>!a.dueOn));
  c.invoice.paidAt = '2026-10-24';
  assert.ok(contractActions(c, [], {}, '2026-10-23').some(a=>a.id==='payment'));
});
test('unverified receipt/refund/deletion dates require input; no fabricated deadlines', () => {
  const c=fresh();
  const result=contractActions(c,[],{acceptance:{active:true},refund:{active:true},deletion:{active:true}},'2026-10-23');
  assert.equal(result.length,3);assert.ok(result.every(a=>a.urgency==='input'&&!a.dueOn));
});
test('14-day receipt and refund clocks use their distinct verified facts', () => {
  const result=contractActions(fresh(),[],{acceptance:{active:true,receivedOn:'2026-10-09'},refund:{active:true,amountFixedOn:'2026-10-10'},deletion:{active:true,agreedDueOn:'2026-10-22'}},'2026-10-23');
  assert.equal(result.find(a=>a.id==='acceptance')?.dueOn,'2026-10-23');
  assert.equal(result.find(a=>a.id==='refund')?.dueOn,'2026-10-24');
  assert.equal(result.find(a=>a.id==='deletion')?.urgency,'overdue');
});
test('future receipt and malformed or future completion cannot falsely close an action', () => {
  for(const completedOn of ['2026-02-30','2026-10-24','2026-10-01']) {
    const result=contractActions(fresh(),[],{refund:{active:true,amountFixedOn:'2026-10-09',completedOn}},'2026-10-23');
    assert.ok(result.some(a=>a.id==='refund'));assert.ok(result.some(a=>a.id==='refund-completion'));
  }
  const result=contractActions(fresh(),[],{acceptance:{active:true,receivedOn:'2026-10-24'}},'2026-10-23');
  assert.equal(result[0].urgency,'input');assert.equal(result[0].dueOn,undefined);
});
test('only explicit completed evidence closes corresponding action; reading changes nothing', () => {
  const c=fresh();const evidence={refund:{active:true,amountFixedOn:'2026-10-01',completedOn:'2026-10-02'},deletion:{active:true,agreedDueOn:'2026-10-25'}};
  const before=JSON.stringify({c,evidence});
  assert.deepEqual(contractActions(c,[],evidence,'2026-10-23').map(a=>a.id),['deletion']);
  assert.equal(JSON.stringify({c,evidence}),before);
});
test('renewal uses original month-end anniversary and prior-day stop at JST 23:59', () => {
  const c=fresh(); c.support={contract:{autoRenew:'1m',startDate:'2026-01-31'}} as Support;
  const result=contractActions(c,[],{},'2026-02-14');
  assert.equal(result.find(a=>a.id.startsWith('renewal-invoice'))?.dueOn,'2026-02-14');
  const stop=result.find(a=>a.id.startsWith('renewal-stop'))!;
  assert.equal(stop.dueOn,'2026-02-27');assert.match(stop.detail,/23:59（日本時間）/);
  const march=contractActions(c,[],{},'2026-03-01');
  assert.equal(march.find(a=>a.id.startsWith('renewal-invoice'))?.dueOn,'2026-03-17');
  assert.ok(contractActions(c,[],{renewalInvoiceFor:'2026-02-28'},'2026-02-14').every(a=>!a.id.startsWith('renewal-invoice')));
});
test('three-day approaching window; no popup storm after actions change or dismiss', () => {
  const future=contractActions(fresh(),[],{deletion:{active:true,agreedDueOn:'2026-10-27'}},'2026-10-23');
  const near=contractActions(fresh(),[],{deletion:{active:true,agreedDueOn:'2026-10-26'}},'2026-10-23');
  const seen=new Set<string>();
  assert.equal(claimContractActionPopup('c',future,seen),false);
  assert.equal(claimContractActionPopup('c',near,seen),true);
  assert.equal(claimContractActionPopup('c',near,seen),false);
  assert.equal(claimContractActionPopup('c',contractActions(fresh(),['new'],{},'2026-10-23'),seen),false);
  assert.equal(claimContractActionPopup('different',near,seen),true);
});
test('UI uses labelled native modal with Escape handling; no external side effects', () => {
  const source=readFileSync(new URL('../packages/web/src/web/components/contract-action-panel.tsx',import.meta.url),'utf8');
  for(const text of ['<dialog','aria-labelledby={titleId}','aria-describedby={descriptionId}','node.showModal()','onCancel={close}','previousFocus.current?.focus()']) assert.ok(source.includes(text),text);
  assert.doesNotMatch(source,/Notification|fetch\(|sendMail|window\.open|vaultStore|changeDocumentStatus/);
});

test('lost and completed cases retain explicit outstanding refund/deletion actions', () => {
  for (const status of ['lost','done'] as const) {
    const c=fresh(); c.status=status; c.invoice.paidFlag=false;
    const result=contractActions(c,['missing'],{refund:{active:true,amountFixedOn:'2026-10-01'},deletion:{active:true}},'2026-10-23');
    assert.equal(result.find(a=>a.id==='refund')?.urgency,'overdue');
    assert.equal(result.find(a=>a.id==='deletion')?.urgency,'input');
    assert.ok(result.every(a=>a.id!=='conditions'&&a.id!=='payment'));
  }
});

test('past unprocessed renewal remains actionable after next-cycle rollover', () => {
  const c=fresh();c.support={contract:{autoRenew:'1m',startDate:'2026-09-01'}} as Support;
  assert.ok(contractActions(c,[],{},'2026-10-01').some(a=>a.id==='renewal-invoice:2026-10-01'&&a.urgency==='overdue'));
  assert.ok(contractActions(c,[],{},'2026-10-02').some(a=>a.id==='renewal-history'));
  assert.ok(contractActions(c,[],{renewalInvoiceFor:'2026-11-01'},'2026-10-02').some(a=>a.id==='renewal-history'));
  assert.ok(contractActions(c,[],{renewalReconciledThrough:'2026-10-01'},'2026-10-02').every(a=>a.id!=='renewal-history'));
  assert.ok(contractActions(c,[],{renewalReconciledThrough:'2026-11-01'},'2026-10-02').some(a=>a.id==='renewal-history'));
});

test('monthly execution without support uses explicit start but mismatched sources fail closed',()=>{
 const c=fresh();c.execution={contractType:'monthly',contractStart:'2026-01-31'} as any;c.support=null;
 assert.ok(contractActions(c,[],{},'2026-03-01').some(a=>a.id==='renewal-invoice:2026-03-31'));
 c.support={contract:{autoRenew:'1m',startDate:'2026-02-01'}} as any;
 const result=contractActions(c,[],{},'2026-03-01');assert.ok(result.some(a=>a.id==='renewal-date'));
 assert.ok(!result.some(a=>a.id.startsWith('renewal-invoice:')));
});
