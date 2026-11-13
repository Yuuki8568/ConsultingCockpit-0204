import { useEffect, useRef, useState } from "react";
import type { AuditVerificationResult } from "../../shared/audit-verification";
import { client } from "../lib/api";
import { verifyAllAuditPages } from "../lib/audit-verification";
import { Note } from "./kit";

export function AuditVerificationControl() {
  const [result, setResult] = useState<AuditVerificationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  const incomplete = (reason: string) => setResult(previous => ({
    ...previous, ok: false, complete: true, checked: previous?.checked ?? 0,
    total: previous?.total ?? 0, startedAtMs: previous?.startedAtMs ?? Date.now(),
    startsAtSeq: previous?.startsAtSeq ?? 0, reason,
  }));
  const verify = async () => {
    if (busy) {
      active.current?.abort(); active.current = null; setBusy(false);
      incomplete("確認を中止しました。全件の確認は完了していません。");
      return;
    }
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setResult(null);
    try {
      await verifyAllAuditPages(
        input => client.audit.verifyChain(input, { signal: controller.signal }),
        progress => { if (active.current === controller) setResult(progress); },
        controller.signal,
      );
    } catch {
      if (active.current === controller)
        incomplete("検証を完了できません。通信とログイン状態を確認し、最初から確認してください。");
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  };
  return <div className="mb-3">
    <button className="btn btn-sm mb-3 min-h-[44px]" onClick={() => void verify()}>
      {busy ? "確認を中止" : "改ざんがないか確認"}
    </button>
    {busy && <p role="status" className="mb-3 text-sm">
      {result ? `${result.total} 件中 ${result.checked} 件を確認中です。全件の確認はまだ完了していません。` : "監査記録の確認を開始しています…"}
    </p>}
    {result?.complete && <Note tone={result.ok ? "ok" : "alert"}>
      {result.ok ? `${result.checked} 件の連鎖と、独立保存済みの地点が一致しました。` :
        `検査未完了または不一致：${result.reason}`}
    </Note>}
  </div>;
}
