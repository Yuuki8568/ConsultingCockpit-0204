/**
 * デスクトップ版だけに出る「手元への控え」機能。
 *
 * Web 版はブラウザのダウンロードにしか書けないが、デスクトップ版は
 * 保存先を指定できる。外付けドライブや社外に出ないフォルダへ、
 * 決まった場所に控えを置き続けられるようにする。
 */
import { useState } from "react";
import { useDesktop } from "../hooks/use-desktop";
import { useVault } from "../hooks/use-vault";
import { ConfirmButton, Note, Panel, Stat, Grid } from "./kit";
import { relativeTime } from "../domain/logic/util";
import { vaultStore } from "../lib/store/vault-store";
import { buildEncryptedBackup } from "../lib/export/backup";

const KEY_DIR = "cockpit.desktopBackupPath";
const KEY_LAST = "cockpit.desktopBackupLast";

export function DesktopBackup() {
  const desktop = useDesktop();
  const { state, audit } = useVault();
  const [target, setTarget] = useState<string>(() => localStorage.getItem(KEY_DIR) ?? "");
  const [last, setLast] = useState<number>(() => Number(localStorage.getItem(KEY_LAST) ?? 0));
  const [msg, setMsg] = useState<{ tone: "ok" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // デスクトップ以外では何も出さない
  if (!desktop || !state) return null;

  const pick = async () => {
    const p = await desktop.showSaveDialog({
      title: "控えの保存先を決める",
      defaultPath: `cockpit-backup_${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!p) return;
    setTarget(p);
    localStorage.setItem(KEY_DIR, p);
    setMsg(null);
  };

  const save = async () => {
    if (!target) {
      await pick();
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // 保存先のファイル名だけ日付を差し替えて、上書きせず積み上げる
      const path = target.replace(
        /(_\d{4}-\d{2}-\d{2})?\.json$/,
        `_${new Date().toISOString().slice(0, 10)}.json`,
      );
      const content = await (async () => {
        const s = vaultStore.getState();
        if (!s) throw new Error("金庫が施錠されています");
        return buildEncryptedBackup(s);
      })();
      try {
        await desktop.writeFile(path, content);
      } catch {
        // アプリを開き直した直後は、保存先をもう一度選び直してもらう決まりにしている。
        // （画面側から任意の場所へ書けないようにしているため）
        const again = await desktop.showSaveDialog({
          title: "控えの保存先をもう一度選んでください",
          defaultPath: path,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (!again) {
          setMsg({ tone: "alert", text: "保存先が選ばれなかったため中止しました。" });
          return;
        }
        setTarget(again);
        localStorage.setItem(KEY_DIR, again);
        await desktop.writeFile(again, content);
      }
      const now = Date.now();
      setLast(now);
      localStorage.setItem(KEY_LAST, String(now));
      audit("desktop_backup");
      setMsg({ tone: "ok", text: `書き出しました：${path}` });
      await desktop.showNotification(
        "Consulting Cockpit",
        "手元への控えを書き出しました",
      );
    } catch (e) {
      setMsg({ tone: "alert", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const stale = last > 0 && Date.now() - last > 7 * 86400000;

  return (
    <Panel
      title="手元への控え（デスクトップ版のみ）"
      note="決めた場所に控えを置き続けられます。日付ごとに別ファイルになります。"
    >
      <Grid cols={2}>
        <Stat
          label="保存先"
          value={
            <span className="text-[12px] break-all">
              {target ? target.replace(/^.*[\\/]/, "") : "未設定"}
            </span>
          }
          sub={target ? target.replace(/[^\\/]*$/, "") : "下のボタンで決めます"}
        />
        <Stat
          label="最後に書き出した日"
          value={last > 0 ? relativeTime(last) : "—"}
          color={stale ? "#C9A961" : last > 0 ? "#4A7C59" : undefined}
        />
      </Grid>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button className="btn btn-sm" onClick={() => void pick()}>
          保存先を決める
        </button>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
          {busy ? "書き出しています…" : "いま書き出す"}
        </button>
        {target && (
          <ConfirmButton
            label="保存先を忘れる"
            confirmLabel="忘れる"
            onConfirm={() => {
              setTarget("");
              localStorage.removeItem(KEY_DIR);
            }}
          />
        )}
      </div>

      {stale && (
        <div className="mt-3">
          <Note tone="warn">
            最後の控えから1週間以上たっています。案件 {state.cases.length} 件・リード{" "}
            {state.leads.length} 件ぶんの控えを取り直しておいてください。
          </Note>
        </div>
      )}
      {msg && (
        <div className="mt-3">
          <Note tone={msg.tone}>{msg.text}</Note>
        </div>
      )}
      <div className="mt-3">
        <Note tone="info">
          控えは暗号化されています。開くにはこの金庫のパスフレーズが要ります。
          録画・録音の本体は控えに含まれません（この端末にだけ置いてあるため）。
        </Note>
      </div>
    </Panel>
  );
}
