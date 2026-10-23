import { useEffect, useState } from 'react';
import { useVault } from '../hooks/use-vault';
import { archiveOriginal, backupSupported, chooseBackupFolder, getBackupConfig, pauseBackup, permitBackup, runBackup, type BackupConfig } from '../lib/backup/automatic';

function useBackupStatus() {
  const [config, setConfig] = useState<BackupConfig>();
  useEffect(() => {
    const update = () => { void getBackupConfig().then(setConfig).catch(() => {}); };
    update(); window.addEventListener('cockpit-backup', update);
    return () => window.removeEventListener('cockpit-backup', update);
  }, []);
  return config;
}
export function AutomaticBackupRunner() {
  const { phase } = useVault();
  const config = useBackupStatus();
  useEffect(() => {
    if (phase !== 'unlocked' || !backupSupported()) return;
    const tick = () => { void runBackup().catch(() => {}); };
    tick(); const timer = window.setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [phase]);
  if (phase !== 'unlocked' || !config?.enabled || !config.message?.includes('未完了')) return null;
  return <div role="status" className="fixed bottom-2 left-2 z-50 max-w-md rounded bg-amber-100 p-3 text-sm text-black">{config.message} 設定の「自動バックアップ」を確認してください。</div>;
}
export function AutomaticBackupSettings() {
  const { state } = useVault();
  const config = useBackupStatus();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [recordId, setRecordId] = useState('');
  const recordings = state?.cases.flatMap(c => c.recordings ?? []) ?? [];
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMessage('');
    try { await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 rounded border p-4" aria-label="自動バックアップ">
    <h3 className="font-bold">自動バックアップ（Google Drive同期フォルダー）</h3>
    <p className="text-sm">MacのChromeで、Google Drive内の「Cockpit 自動バックアップ」フォルダーを選んでください。案件データは暗号化し、原本は暗号化せず専用フォルダーに保存します。原本もDriveへアップロードされます。</p>
    <p className="text-sm">解錠して開いている間に24時間ごとに保存。終了・スリープ中は次回解錠時に再開します。Driveへの転送完了はGoogle Driveで確認してください。保存時の金庫パスフレーズが復元に必要です。</p>
    <p>状態：{config?.enabled ? '有効' : '停止／未設定'} ／ 保存先：{config?.directory.name ?? '未選択'}</p>
    <p>最終保存：{config?.last ? new Date(config.last).toLocaleString() : '未実行'}</p>
    <p role="status">{message || config?.message}</p>
    {!backupSupported() ? <p>このブラウザーでは自動保存先を指定できません。MacのChromeで設定してください。</p> : <div className="flex flex-wrap gap-3">
      <button disabled={busy} onClick={() => void action(chooseBackupFolder)}>保存先フォルダーを選択</button>
      <button disabled={busy || !config} onClick={() => void action(async () => { await permitBackup(); await runBackup(true); })}>{busy ? '保存・検証中…' : '保存を許可して今すぐ実行'}</button>
      <button disabled={busy || !config?.enabled} onClick={() => void action(pauseBackup)}>自動保存を停止</button>
    </div>}
    {config && recordings.length > 0 && <div className="space-y-2">
      <p className="text-sm">未保存の原本がある場合は、該当する録音を選び元ファイルを指定してください。</p>
      <select aria-label="原本を追加する録音" value={recordId} onChange={e => setRecordId(e.target.value)}><option value="">録音・動画を選択</option>{recordings.map(r => <option key={r.id} value={r.id}>{r.name}（{r.addedAt}）</option>)}</select>
      <input type="file" aria-label="バックアップする原本" disabled={busy || !recordId || !config.enabled} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; const meta = recordings.find(r => r.id === recordId); if (file && meta) void action(async () => { if (file.name !== meta.name || file.size !== meta.size) throw new Error('登録時と同じ名前・サイズの原本を選択してください'); await permitBackup(); await archiveOriginal(meta, file); await runBackup(true); }); }} />
    </div>}
  </section>;
}
