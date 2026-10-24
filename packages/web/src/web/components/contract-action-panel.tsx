import { useEffect, useId, useRef, useState } from 'react';
import type { CaseRecord } from '../domain/types';
import { isApprovedVersion } from '../domain/data/contract-revisions';
import { claimContractActionPopup, contractActions, contractActionPopupEligible, contractTodayJst, type ContractActionEvidence, type ContractActionTarget } from '../domain/logic/contract-actions';

const seenThisSession = new Set<string>();
const labels = { overdue: '期限経過・要確認', input: '入力・確認が必要', due: '期限が近い', upcoming: '予定', info: '案内' };
const destinations = { conditions: '契約条件を確認', payment: '入金記録を確認', support: '月額契約を確認', evidence: '対応日付を確認' };
const storageKey = (id: string) => `cockpit.contract-action-popup.v1:${id}`;

export function ContractActionPanel({ c, missingFacts, evidence = {}, onEvidenceChange, onNavigate }: {
  c: CaseRecord;
  missingFacts: readonly string[];
  evidence?: ContractActionEvidence;
  onEvidenceChange: (e: ContractActionEvidence) => void;
  onNavigate: (target: Exclude<ContractActionTarget, 'evidence'>) => void;
}) {
  const [today, setToday] = useState(contractTodayJst);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const evidenceSection = useRef<HTMLDetailsElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const actions = contractActions(c, missingFacts, evidence, today);
  const urgent = actions.filter(contractActionPopupEligible);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(contractTodayJst()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    try { if (sessionStorage.getItem(storageKey(c.id))) seenThisSession.add(c.id); } catch { /* in-memory dedupe remains available */ }
    if (claimContractActionPopup(c.id, actions, seenThisSession)) {
      try { sessionStorage.setItem(storageKey(c.id), 'shown'); } catch { /* no storage permission needed */ }
      setOpen(true);
    }
  }, [c.id, actions]);
  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      node.showModal();
    } else if (!open && node?.open) node.close();
    return () => { if (node?.open) node.close(); };
  }, [open]);
  const close = () => { dialog.current?.close(); setOpen(false); previousFocus.current?.focus(); };
  const go = (target: ContractActionTarget) => {
    close();
    if (target === 'evidence') {
      if (evidenceSection.current) {
        evidenceSection.current.open = true;
        evidenceSection.current.querySelector('summary')?.focus();
        evidenceSection.current.scrollIntoView({ block: 'center' });
      }
    } else onNavigate(target);
  };
  const showActions = (items: typeof actions) => <ul className="space-y-3">{items.map(a => <li key={a.id} className="rounded border p-3">
    <p className="font-semibold">{labels[a.urgency]}：{a.title}</p>
    {a.dueOn && <p>基準期限：{a.dueOn}（日本時間）</p>}
    <p className="text-sm">{a.detail}</p>
    {a.id !== 'legacy' && <button type="button" className="btn btn-outline mt-2" onClick={() => go(a.target)}>{destinations[a.target]}</button>}
  </li>)}</ul>;
  const dateField = (label: string, value: string | undefined, change: (v: string) => void, actual = true) => <label className="grid gap-1 text-sm">{label}<input className="rounded border p-2" type="date" value={value ?? ''} max={actual ? today : undefined} onChange={e => change(e.target.value)} /></label>;
  return <section aria-label="契約アクション確認" className="space-y-3 rounded border p-4">
    <h2 className="font-semibold">契約アクション確認</h2>
    <p className="text-sm">確認を促す案内です。表示・閉じる操作では対応済みにしません。送付・請求・送金・削除は自動実行しません。</p>
    {actions.length ? showActions(actions) : <p>現在の記録に基づく確認項目はありません。契約完了を保証するものではありません。</p>}
    {urgent.length > 0 && <button className="btn btn-outline" type="button" onClick={() => setOpen(true)}>要対応 {urgent.length} 件をまとめて表示</button>}
    {isApprovedVersion(c.contractTemplateVersion) && <details ref={evidenceSection} className="rounded border p-3">
      <summary className="cursor-pointer font-semibold">確認済みの対応日付を記録</summary>
      <p className="my-2 text-sm">対象になる場合だけ有効にし、証拠を確認した実日付を入力してください。予定・推測を実績として入力しないでください。完了日の記録は手動確認です（契約本文・締結状態は変更しません）。</p>
      <div className="space-y-4">
        {(['acceptance', 'refund', 'deletion'] as const).map(key => {
          const record = evidence[key];
          const label = key === 'acceptance' ? '検収・受領確認' : key === 'refund' ? '返金' : '返却・削除';
          const update = (values: object) => onEvidenceChange({ ...evidence, [key]: { ...record, active: record?.active ?? false, ...values } });
          return <fieldset key={key} className="space-y-2 rounded border p-3"><legend>{label}</legend>
            <label><input type="checkbox" checked={record?.active ?? false} onChange={e => update({ active: e.target.checked })} /> この案件で対応が必要</label>
            {record?.active && <>
              {key === 'acceptance' && dateField('確認済みの受領日', evidence.acceptance?.receivedOn, v => update({ receivedOn: v }))}
              {key === 'refund' && dateField('返金額が確定した日', evidence.refund?.amountFixedOn, v => update({ amountFixedOn: v }))}
              {key === 'deletion' && dateField('個別に合意・確認した返却・削除期限', evidence.deletion?.agreedDueOn, v => update({ agreedDueOn: v }), false)}
              {dateField('対応完了を確認した実日付（未完了なら空欄）', record.completedOn, v => update({ completedOn: v }))}
            </>}
          </fieldset>;
        })}
        {(c.support?.contract.autoRenew === '1m' || c.execution?.contractType === 'monthly') && <>{dateField('過去の更新分すべての発行・取消・精算を照合済み：最終更新日', evidence.renewalReconciledThrough, v => onEvidenceChange({ ...evidence, renewalReconciledThrough: v }))}{dateField('請求の発行済み確認：対象の更新日（発行日ではありません）', evidence.renewalInvoiceFor, v => onEvidenceChange({ ...evidence, renewalInvoiceFor: v }), false)}</>}
      </div>
    </details>}
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={close} onClose={() => setOpen(false)} className="m-auto max-h-[85vh] w-[min(42rem,95vw)] overflow-y-auto rounded-lg border bg-white p-5 text-gray-900 shadow-xl backdrop:bg-black/40">
      <h2 id={titleId} className="text-lg font-semibold">契約の確認が必要です</h2>
      <p id={descriptionId} className="my-3 text-sm">該当箇所へ進み、実際の条件・証拠をご確認ください。閉じても対応済みにはなりません。同一セッション・同一案件での自動表示は1回です。</p>
      <button type="button" autoFocus className="btn btn-outline mb-3" onClick={close}>今は閉じる</button>
      {showActions(urgent)}
    </dialog>
  </section>;
}
