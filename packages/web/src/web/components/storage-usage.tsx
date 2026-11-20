import { useEffect, useRef, useState } from "react";
import type { StorageUsage } from "../../api/security/storage-usage";
import { client } from "../lib/api";
import { Note, Panel } from "./kit";

function bytes(value: number) {
  if (value < 1024) return `${value.toLocaleString("ja-JP")} B`;
  if (value < 1024 * 1024)
    return `${(value / 1024).toLocaleString("ja-JP", { maximumFractionDigits: 1 })} KiB`;
  return `${(value / (1024 * 1024)).toLocaleString("ja-JP", { maximumFractionDigits: 1 })} MiB`;
}

/** Explicit inspection only: opening settings must not repeatedly scan the DB. */
export function StorageUsagePanel() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );

  async function inspect() {
    if (pending.current) return;
    pending.current = true;
    const current = epoch.current;
    setUsage(null);
    setError(false);
    setBusy(true);
    try {
      if (!navigator.onLine) throw new Error("offline");
      const value = await client.vault.storageUsage();
      if (current === epoch.current) setUsage(value);
    } catch {
      if (current === epoch.current) setError(true);
    } finally {
      pending.current = false;
      if (current === epoch.current) setBusy(false);
    }
  }

  const alerts = usage?.limits.filter((limit) => limit.severity !== "normal") ?? [];
  return (
    <Panel
      title="保存容量と増え方"
      note="確認ボタンを押したときだけ集計します。履歴の削除や契約の変更は行いません。"
    >
      <button
        type="button"
        className="btn btn-primary min-h-11"
        disabled={busy}
        onClick={() => void inspect()}
      >
        {busy ? "保存容量を確認中…" : "保存容量を確認"}
      </button>
      <div className="mt-3 space-y-3" aria-live="polite" aria-busy={busy}>
        {error && (
          <Note tone="warn">
            保存容量を確認できませんでした。通信状態を確認して、しばらくしてから再試行してください。
          </Note>
        )}
        {usage && (
          <>
            <p className="text-[12px] text-paper-dim">
              {usage.backend === "d1" ? "Cloudflare D1" : "現在のサーバーDB"}：
              {new Date(usage.measuredAtMs).toLocaleString("ja-JP")} の確認結果
            </p>
            <table className="w-full text-[12px]" aria-label="保存容量の内訳">
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="py-2 pr-2">
                    内容
                  </th>
                  <th scope="col" className="py-2 pr-2 text-right">
                    件数
                  </th>
                  <th scope="col" className="py-2 text-right">
                    容量
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["案件・リード等", usage.records.liveCount, usage.records.liveEncryptedBytes],
                  [
                    "削除済みの記録",
                    usage.records.deletedCount,
                    usage.records.deletedEncryptedBytes,
                  ],
                  ["変更前の保存履歴", usage.revisions.count, usage.revisions.logicalBytes],
                  ["監査記録の暗号化本文", usage.audit.count, usage.audit.encryptedPayloadBytes],
                ].map(([label, count, size]) => (
                  <tr key={label} className="border-b border-line/50">
                    <th scope="row" className="py-2 pr-2 text-left font-normal">
                      {label}
                    </th>
                    <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">
                      {Number(count).toLocaleString("ja-JP")}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">
                      {bytes(Number(size))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2} className="py-2 pr-2 text-left">
                    表示対象の合計
                  </th>
                  <td className="whitespace-nowrap py-2 text-right tabular-nums">
                    {bytes(usage.logicalBytesTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
            <p className="text-[11px] leading-relaxed text-paper-dim">
              暗号化済みの本文などを合計した目安です。認証データ・索引などや録音・動画原本を含まず、DB全体の使用量や請求額とは異なります。編集を重ねると、変更前の保存履歴も増えます。
            </p>
            {alerts.map((limit) => (
              <Note key={limit.key} tone={limit.severity === "warning" ? "warn" : "alert"}>
                <strong>
                  {limit.label}：
                  {limit.severity === "exceeded"
                    ? "現在の処理上限を超えています"
                    : "現在の処理上限に近づいています"}
                </strong>
                <p>
                  {limit.unit === "bytes"
                    ? bytes(limit.used)
                    : `${limit.used.toLocaleString("ja-JP")} 件`}{" "}
                  /{" "}
                  {limit.unit === "bytes"
                    ? bytes(limit.limit)
                    : `${limit.limit.toLocaleString("ja-JP")} 件`}
                  {limit.basis === "lower-bound" ? "（概算の下限）" : ""}
                </p>
                <p>{limit.note}</p>
              </Note>
            ))}
            <p className="text-[11px] leading-relaxed text-paper-dim">
              この確認は料金の上限設定ではありません。大量の取り込みを行う前に、保存方式と処理上限を見直してください。
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}
