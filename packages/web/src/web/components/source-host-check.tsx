import { useState } from "react";
import { client } from "../lib/api";

export function SourceHostCheck() {
  const [expected, setExpected] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = expected.length === 64 && /^[0-9a-f]{64}$/.test(expected);

  async function check() {
    if (busy || !valid) return;
    setBusy(true);
    setResult("");
    try {
      const response = await client.sync.stats({ expectedSourceHostSha256: expected });
      setResult(response.sourceHostMatches === true ? "接続先が一致しました。"
        : response.sourceHostMatches === false ? "指定した接続先との一致を確認できませんでした。"
        : "照合結果が返りませんでした。");
    } catch {
      setResult("照合できませんでした。ログイン状態と通信を確認してください。");
    } finally {
      setBusy(false);
    }
  }

  return <details className="mt-3 text-sm">
    <summary className="cursor-pointer">移行元の接続先を照合</summary>
    <div className="mt-2 space-y-2">
      <label className="field-label">
        照合用のSHA-256（0〜9・a〜fの64桁）
        <input className="field num mt-1" type="text" maxLength={64} autoComplete="off"
          autoCapitalize="none" spellCheck={false} disabled={busy} value={expected}
          onChange={e => { setExpected(e.target.value); setResult(""); }} />
      </label>
      <button type="button" className="btn btn-sm" disabled={busy || !valid} onClick={() => void check()}>
        {busy ? "照合中…" : "接続先を照合"}
      </button>
      <p aria-live="polite">{result}</p>
    </div>
  </details>;
}
