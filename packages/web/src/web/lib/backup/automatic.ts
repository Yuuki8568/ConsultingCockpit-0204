import type { RecordingMeta } from '../../domain/types';
import { idb } from '../store/idb';
import { vaultStore } from '../store/vault-store';
import { buildEncryptedBackup, decryptBackup } from '../export/backup';

type Directory = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
};
const KEY = 'automatic-backup-v1';
const CHUNK = 8 * 1024 * 1024;
export const DAY = 24 * 60 * 60 * 1000;
export interface MissingOriginal { caseId: string; recordId: string; reason: string }
export interface BackupConfig { directory: Directory; enabled: boolean; last?: number; lastComplete?: number; lastAttempt?: number; snapshotHash?: string; coverage?: string; message?: string; missing?: number; issues?: MissingOriginal[] }
export const RETRY = 5 * 60 * 1000;
export function backupWarningKey(config: BackupConfig) {
  return JSON.stringify([config.message, config.issues?.map(i => [i.recordId, i.reason]).sort()]);
}
const failureReason = (error: unknown) => error instanceof Error && error.message.startsWith('原本データが')
  ? error.message
  : error instanceof DOMException && ['NotReadableError', 'NotFoundError'].includes(error.name)
    ? '元ファイルを読み取れません。Google Driveでダウンロードを完了してから、元ファイルを再選択してください。'
  : error instanceof DOMException && error.name === 'QuotaExceededError'
  ? '保存先の空き容量が不足しています。容量を確保して再試行してください。'
  : error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)
    ? '保存権限がありません。保存を許可して再試行してください。'
    : '原本の読込・保存・検証に失敗しました。保存先を確認するか元ファイルを再選択してください。';
let running = false;
export const getBackupRunning = () => running;
function setRunning(value: boolean) { running = value; window.dispatchEvent(new Event('cockpit-backup')); }
export const getBackupConfig = () => idb.getMeta<BackupConfig>(KEY);
async function saveConfig(config: BackupConfig) { await idb.setMeta(KEY, config); window.dispatchEvent(new Event('cockpit-backup')); }
export function backupSupported() { return 'showDirectoryPicker' in window; }
export async function chooseBackupFolder() {
  const picker = (window as unknown as { showDirectoryPicker(o: unknown): Promise<Directory> }).showDirectoryPicker;
  const directory = await picker({ mode: 'readwrite', id: 'cockpit-backup' });
  for (const name of ['01_案件データ_暗号化', '02_録音・動画原本', '03_復元手順・検証記録']) await directory.getDirectoryHandle(name, { create: true });
  await navigator.locks.request('cockpit-auto-backup', () => saveConfig({ directory, enabled: true, message: '保存先を設定しました。初回保存を実行してください。' }));
}
export async function pauseBackup() { const c = await getBackupConfig(); if (c) await navigator.locks.request('cockpit-auto-backup', async () => { const latest = await getBackupConfig(); if (latest) await saveConfig({ ...latest, enabled: false }); }); }
export async function permitBackup() { const c = await getBackupConfig(); if (!c) throw new Error('保存先を選択してください'); if (await c.directory.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('フォルダーへの保存許可が必要です'); await navigator.locks.request('cockpit-auto-backup', async () => { const latest = await getBackupConfig(); if (!latest || !await latest.directory.isSameEntry(c.directory)) throw new Error('保存先が変更されました。もう一度操作してください'); await saveConfig({ ...latest, enabled: true }); }); }
async function hash(blob: Blob) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join(''); }
export async function writeVerified(dir: FileSystemDirectoryHandle, name: string, blob: Blob) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  const hashes: string[] = [];
  try {
    for (let offset = 0; offset < blob.size; offset += CHUNK) {
      const part = blob.slice(offset, offset + CHUNK);
      hashes.push(await hash(part)); await writer.write(part);
    }
    await writer.close();
  } catch (error) { await writer.abort().catch(() => {}); throw error; }
  const saved = await handle.getFile();
  if (saved.size !== blob.size) throw new Error('保存ファイルのサイズが一致しません');
  for (let i = 0; i < hashes.length; i++) if (await hash(saved.slice(i * CHUNK, (i + 1) * CHUNK)) !== hashes[i]) throw new Error('保存ファイルの検証に失敗しました');
  return hashes;
}
export function mediaName(meta: RecordingMeta) {
  // macOS limits a path component in UTF-8 bytes, not JavaScript characters.
  const prefix = encodeURIComponent(meta.id);
  if (new TextEncoder().encode(prefix).length > 80) throw new Error('録音IDが長すぎます');
  const clean = meta.name.replace(/[\\/:*?"<>|]/g, '_');
  const extension = clean.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0] ?? '';
  const stem = extension ? clean.slice(0, -extension.length) : clean;
  let suffix = '';
  for (const char of stem) {
    if (new TextEncoder().encode(suffix + char + extension).length > 160) break;
    suffix += char;
  }
  return `${prefix}--${suffix || 'original'}${extension}`;
}
async function originalExists(dir: FileSystemDirectoryHandle, meta: RecordingMeta) {
  try {
    const manifest = JSON.parse(await (await (await dir.getFileHandle(`${encodeURIComponent(meta.id)}.json`)).getFile()).text());
    // Keep recognizing archives made with the previous filename algorithm.
    if (manifest.id !== meta.id || manifest.chunkSize !== CHUNK || typeof manifest.file !== 'string' || /[\\/]/.test(manifest.file) || manifest.file === '.' || manifest.file === '..') return false;
    const file = await (await dir.getFileHandle(manifest.file)).getFile();
    if (manifest.size !== meta.size || file.size !== meta.size || !Array.isArray(manifest.hashes) || manifest.hashes.length !== Math.ceil(file.size / CHUNK)) return false;
    for (let i = 0; i < manifest.hashes.length; i++) if (await hash(file.slice(i * CHUNK, (i + 1) * CHUNK)) !== manifest.hashes[i]) return false;
    return true;
  } catch { return false; }
}
async function saveOriginal(dir: FileSystemDirectoryHandle, meta: RecordingMeta, blob: Blob) {
  if (blob.size !== meta.size) throw new Error('原本のサイズが登録情報と一致しません');
  const hashes = await writeVerified(dir, mediaName(meta), blob);
  await writeVerified(dir, `${encodeURIComponent(meta.id)}.json`, new Blob([JSON.stringify({ id: meta.id, file: mediaName(meta), size: blob.size, chunkSize: CHUNK, hashes })]));
}
export function validateOriginalSelection(meta: RecordingMeta, file: File) {
  if (file.size !== meta.size) throw new Error(`選択したファイルのサイズが異なります。登録時：${meta.size.toLocaleString()} bytes、選択：${file.size.toLocaleString()} bytes。編集・変換前の同じ原本を選んでください。`);
  if (file.name.normalize('NFC') !== meta.name.normalize('NFC')) throw new Error(`ファイル名が異なります。登録時：${meta.name}、選択：${file.name}。登録時の名前の原本を選んでください。`);
}
export async function archiveOriginal(meta: RecordingMeta, file: File) {
  validateOriginalSelection(meta, file);
  // Re-read config inside the lock: another tab may change/pause the destination.
  return navigator.locks.request('cockpit-auto-backup', async () => {
    const config = await getBackupConfig();
    if (!config?.enabled) return false;
    try {
      if (await config.directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('自動バックアップ設定から保存許可を更新してください');
      const dir = await config.directory.getDirectoryHandle('02_録音・動画原本', { create: true });
      await saveOriginal(dir, meta, file);
      await saveConfig({ ...config, coverage: undefined, lastAttempt: undefined, message: '原本を保存しました。案件データの次回保存を待っています。' });
      return true;
    } catch (error) {
      await saveConfig({ ...config, coverage: undefined, lastAttempt: undefined, message: `原本バックアップ未完了：${failureReason(error)}` });
      throw error;
    }
  });
}
/** Match explicitly selected originals only; ambiguous names/sizes require manual selection. */
export async function archiveMatchingOriginals(files: File[]) {
  const state = vaultStore.getState();
  if (!state) throw new Error('金庫を解錠してください');
  const config = await getBackupConfig();
  if (!config?.enabled) throw new Error('先に保存を許可してください');
  const records = state.cases.flatMap(c => c.recordings ?? []);
  let saved = 0, skipped = 0;
  for (const file of files) {
    const matches = records.filter(r => r.name.normalize('NFC') === file.name.normalize('NFC') && r.size === file.size);
    if (matches.length !== 1) { skipped++; continue; }
    if (!await archiveOriginal(matches[0], file)) throw new Error('自動保存が停止されています');
    saved++;
  }
  await runBackup(true);
  return { saved, skipped };
}
export async function runBackup(force = false) {
  return navigator.locks.request('cockpit-auto-backup', { ifAvailable: true }, async lock => {
    if (!lock) return;
    const config = await getBackupConfig();
    if (!config?.enabled) return;
    const current = vaultStore.getState();
    if (!current) return;
    const coverage = JSON.stringify(current.cases.flatMap(c => (c.recordings ?? []).map(r => [c.id, r.id, r.size, r.name])).sort());
    // Store a digest, not plaintext recording names, in local backup preferences.
    const coverageHash = await hash(new Blob([coverage]));
    const dailyDue = !config.last || Date.now() - config.last >= DAY;
    const changed = config.coverage !== coverageHash;
    if (!force && !dailyDue && !changed && !config.missing && !config.message?.includes('未完了')) return;
    if (!force && config.lastAttempt && Date.now() - config.lastAttempt < RETRY) return;
    const attempt = Date.now();
    setRunning(true);
    try {
      if (await config.directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('保存権限が必要です。「保存を許可して今すぐ実行」を押してください');
      await vaultStore.flushPending();
      const state = structuredClone(vaultStore.getState());
      if (!state) return;
      const writeSnapshot = force || dailyDue || changed;
      let savedAt = config.last;
      let snapshotHash = config.snapshotHash;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8);
      if (writeSnapshot) {
        const text = await buildEncryptedBackup(state);
        // Verify decryption before accepting this generation as recoverable.
        const restored = JSON.parse(await decryptBackup(text));
        if (JSON.stringify(restored.state) !== JSON.stringify(state)) throw new Error('復元検証に失敗しました');
        const records = await config.directory.getDirectoryHandle('01_案件データ_暗号化', { create: true });
        await writeVerified(records, `cockpit-${stamp}.json`, new Blob([text]));
        snapshotHash = await vaultStore.backupFingerprint(state);
        savedAt = Date.now();
      }
      const originals = await config.directory.getDirectoryHandle('02_録音・動画原本', { create: true });
      const issues: MissingOriginal[] = [];
      const localMediaIds = new Set(await idb.listMediaIds());
      for (const c of state.cases) for (const r of c.recordings ?? []) {
        if (!vaultStore.getState()) throw new Error('施錠されたため原本の保存を中断しました');
        if (await originalExists(originals, r)) continue;
        try {
          if (r.sourceOnly) { issues.push({ caseId: c.id, recordId: r.id, reason: '大容量の原本はこのブラウザーに残っていません。元ファイルを再選択してください。' }); continue; }
          if (!localMediaIds.has(r.id)) throw new Error('原本データがこの端末にありません。案件の同期・JSON復元には動画本体は含まれません。「原本を選んで保存」から元ファイルを指定してください。');
          await saveOriginal(originals, r, await vaultStore.readMediaBlob(r.id, r.mimeType));
        } catch (error) { issues.push({ caseId: c.id, recordId: r.id, reason: failureReason(error) }); }
      }
      const missing = issues.length;
      const docs = await config.directory.getDirectoryHandle('03_復元手順・検証記録', { create: true });
      await writeVerified(docs, '復元手順.txt', new Blob([RESTORE]));
      await writeVerified(docs, `${stamp}.json`, new Blob([JSON.stringify({ at: stamp, recordsVerified: true, recordsSavedAt: savedAt, missingOriginals: missing, issues, cloudUploadVerified: false })]));
      await saveConfig({ ...config, last: savedAt, snapshotHash, lastComplete: missing ? config.lastComplete : Date.now(), lastAttempt: attempt, coverage: coverageHash, missing, issues, message: missing ? `案件データ保存済み。原本${missing}件が未保存です（全体バックアップ未完了）。` : '案件データ・登録済み原本の保存と読戻し検証が完了しました。Driveの同期完了は別途確認してください。' });
    } catch (error) {
      await saveConfig({ ...config, lastAttempt: attempt, message: `バックアップ未完了：${error instanceof Error ? error.message : String(error)}` });
    } finally { setRunning(false); }
  });
}
const RESTORE = `Cockpit 自動バックアップ\n01の最新のJSONをCockpit設定のバックアップ読込から選び、保存時の金庫パスフレーズで復元してください。パスフレーズはこのフォルダーとは別に保管してください。\n02には暗号化していない録音・動画原本と検証用JSONを保存します。原本は該当案件の録音・動画から再取り込みできます（別の録音として追加されます）。\n03の日付別検証記録でmissingOriginalsが0か確認してください。0以外なら原本の再選択が必要です。\nMacの故障に備え、Google Driveのアップロード完了を確認してください。アプリはクラウドへの転送完了までは確認できません。\n自動保存はこのMacでCockpitを開いて解錠している間に24時間ごと。閉じている間・スリープ中は保存されず、次回解錠時に再開します。世代の自動削除は行いません。\nブラウザー内の未同期データを含む案件情報と登録済み録音・動画を対象にします。Mac全体、他アプリ、登録していないファイル、ログイン用秘密情報は対象外です。\n`;
