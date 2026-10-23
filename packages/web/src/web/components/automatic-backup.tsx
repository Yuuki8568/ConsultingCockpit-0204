import { useEffect, useState, useSyncExternalStore } from 'react';
import { vaultStore } from '../lib/store/vault-store';
import { useVault } from '../hooks/use-vault';
import { archiveOriginal, archiveMatchingOriginals, backupWarningKey, backupSupported, chooseBackupFolder, getBackupConfig, getBackupRunning, pauseBackup, permitBackup, runBackup, type BackupConfig } from '../lib/backup/automatic';

function useBackupStatus() {
  const [config, setConfig] = useState<BackupConfig>();
  useEffect(() => {
    const update = () => { void getBackupConfig().then(setConfig).catch(() => {}); };
    update(); window.addEventListener('cockpit-backup', update);
    return () => window.removeEventListener('cockpit-backup', update);
  }, []);
  return config;
}
const backupButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-sky-400/70 bg-sky-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-45';
const filePicker = 'block w-full rounded-lg border border-sky-400/60 bg-sky-950/20 p-2 text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-sky-400 file:bg-sky-800 file:px-3 file:py-2 file:font-semibold file:text-white hover:file:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-45';
function useBackupRunning() {
  return useSyncExternalStore(listener => { window.addEventListener('cockpit-backup', listener); return () => window.removeEventListener('cockpit-backup', listener); }, getBackupRunning);
}
export function BackupBadge({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { phase, revision } = useVault();
  const config = useBackupStatus();
  const running = useBackupRunning();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<{ revision: number; hash: string }>();
  useEffect(() => {
    let active = true;
    const state = vaultStore.getState();
    if (phase === 'unlocked' && state) {
      // Hash the exact snapshot; an edit during hashing cannot mark newer data saved.
      void vaultStore.backupFingerprint(structuredClone(state)).then(hash => { if (active) setChecked({ revision, hash }); }).catch(() => { if (active) setChecked(undefined); });
    } else setChecked(undefined);
    return () => { active = false; };
  }, [phase, revision]);
  if (phase !== 'unlocked') return null;
  const dirty = !config?.snapshotHash || checked?.revision !== revision || checked?.hash !== config.snapshotHash;
  const failed = !!error || !!config?.missing || !!config?.message?.includes('未完了');
  const working = busy || running;
  const label = working ? 'バックアップ中…' : !config ? 'バックアップ未設定' : !config.enabled ? '自動バックアップ停止中' : failed ? 'バックアップ要確認' : dirty ? '未バックアップ' : 'バックアップ済み';
  const color = working ? '#bae6fd' : failed ? '#fecaca' : !config || !config.enabled || dirty ? '#fde68a' : '#bbf7d0';
  const bg = working ? '#0c4a6e' : failed ? '#7f1d1d' : !config || !config.enabled || dirty ? '#713f12' : '#14532d';
  const save = async () => {
    if (!config || !backupSupported()) { onOpenSettings(); return; }
    setBusy(true); setError('');
    try { await permitBackup(); await runBackup(true); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <div className="flex max-w-full flex-wrap items-center gap-1" aria-label="バックアップ操作">
    <button type="button" className="btn btn-sm min-h-9 border" style={{ color, borderColor: color, background: bg }} disabled={working}
      aria-label={`${label}：${config ? '今すぐバックアップ' : '保存先を設定'}`} onClick={() => void save()}
      title={`案件データを暗号化し、指定フォルダーに日付別で保存します。${config?.last ? '最終保存：' + new Date(config.last).toLocaleString() : '初回は保存先を設定してください。'} 原本とDrive同期の状態は設定で確認できます。`}>
      <span aria-hidden="true">●</span><span>{label}</span><span className="text-xs">{working ? '' : config ? '／今すぐ保存' : '／設定'}</span>
    </button>
    {failed && <button type="button" className="btn btn-sm border border-red-300 text-red-200" onClick={onOpenSettings}>詳細</button>}
    {error && <span role="alert" className="max-w-xs text-xs text-red-300">{error}</span>}
  </div>;
}

export function AutomaticBackupRunner() {
  const { phase } = useVault();
  const config = useBackupStatus();
  const [dismissed, setDismissed] = useState(() => { try { return sessionStorage.getItem('cockpit-backup-dismissed') ?? ''; } catch { return ''; } });
  const warning = config ? backupWarningKey(config) : '';
  const dismiss = () => { setDismissed(warning); try { sessionStorage.setItem('cockpit-backup-dismissed', warning); } catch { /* memory fallback */ } };
  useEffect(() => {
    if (phase !== 'unlocked' || !backupSupported()) return;
    const tick = () => { void runBackup().catch(() => {}); };
    tick(); const timer = window.setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [phase]);
  if (phase !== 'unlocked' || !config?.enabled || !config.message?.includes('未完了') || warning === dismissed) return null;
  return <div role="status" className="fixed bottom-2 left-2 z-50 max-w-md rounded bg-amber-100 p-3 text-sm text-black">{config.message} 設定の「自動バックアップ」を確認してください。<button type="button" aria-label="バックアップ通知を閉じる" className="ml-3 rounded border px-2 py-1" onClick={dismiss}>閉じる ×</button></div>;
}
export function AutomaticBackupSettings() {
  const { state } = useVault();
  const config = useBackupStatus();
  const [busy, setBusy] = useState(false);
  const running = useBackupRunning();
  const disabled = busy || running;
  const [message, setMessage] = useState('');
  const [recordId, setRecordId] = useState('');
  const issues = config?.issues ?? [];
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
    <p>案件データ最終保存：{config?.last ? new Date(config.last).toLocaleString() : '未実行'}</p>
    <p>全体の最終検証完了：{config?.lastComplete ? new Date(config.lastComplete).toLocaleString() : '未確認'}</p>
    <p role="status">{config?.message}</p>
    {message && <p role="status">{message}</p>}
    <p className="text-sm">通知を閉じても未保存の状態と再試行は継続します。未完了分は解錠中に約5分ごとに再確認します。</p>
    {issues.length > 0 && <ul aria-label="未保存の原本" className="space-y-2">{issues.map(issue => {
      const meta = recordings.find(r => r.id === issue.recordId);
      return <li key={`${issue.caseId}:${issue.recordId}`} className="rounded border p-2"><strong>{meta?.name ?? '録音・動画'}</strong><p>{issue.reason}</p><button type="button" className={backupButton} onClick={() => setRecordId(issue.recordId)}>この原本を指定する</button></li>;
    })}</ul>}
    {!!config?.missing && !issues.length && <p>既存の未保存情報を更新するため「保存を許可して今すぐ実行」を押してください。</p>}
    {!backupSupported() ? <p>このブラウザーでは自動保存先を指定できません。MacのChromeで設定してください。</p> : <div className="flex flex-wrap gap-3">
      <button type="button" className={backupButton} disabled={disabled} onClick={() => void action(chooseBackupFolder)}>保存先フォルダーを選択</button>
      <button type="button" className={backupButton} disabled={disabled || !config} onClick={() => void action(async () => { await permitBackup(); await runBackup(true); })}>{disabled ? '保存・検証中…' : '保存を許可して今すぐ実行'}</button>
      <button type="button" className={backupButton} disabled={disabled || !config?.enabled} onClick={() => void action(pauseBackup)}>自動保存を停止</button>
    </div>}
    {config && recordings.length > 0 && <div className="space-y-2">
      <p className="text-sm">未保存の原本がある場合は、該当する録音を選び元ファイルを指定してください。</p>
      <select className="block min-h-10 w-full rounded-lg border border-sky-400/60 bg-ink-800 px-3 py-2" aria-label="原本を追加する録音" value={recordId} onChange={e => setRecordId(e.target.value)}><option value="">録音・動画を選択</option>{recordings.map(r => <option key={r.id} value={r.id}>{r.name}（{r.addedAt}）</option>)}</select>
      <input className={filePicker} type="file" aria-label="バックアップする原本" disabled={disabled || !recordId || !config.enabled} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; const meta = recordings.find(r => r.id === recordId); if (file && meta) void action(async () => { if (file.name !== meta.name || file.size !== meta.size) throw new Error('登録時と同じ名前・サイズの原本を選択してください'); await permitBackup(); await archiveOriginal(meta, file); await runBackup(true); }); }} />
      <label className="block">複数の原本をまとめて補完
        <input className={filePicker} type="file" multiple aria-label="原本をまとめて補完" disabled={disabled || !config.enabled} onChange={e => {
          const files = Array.from(e.target.files ?? []); e.target.value = '';
          if (files.length) void action(async () => { await permitBackup(); const result = await archiveMatchingOriginals(files); setMessage(`${result.saved}件の原本を保存しました。${result.skipped}件は名前・サイズで一意に照合できないため、対象を選んで個別に指定してください。`); });
        }} />
      </label>
    </div>}
  </section>;
}
