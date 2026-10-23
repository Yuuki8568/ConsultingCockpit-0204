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
export interface BackupConfig { directory: Directory; enabled: boolean; last?: number; message?: string; missing?: number }
export const getBackupConfig = () => idb.getMeta<BackupConfig>(KEY);
async function saveConfig(config: BackupConfig) { await idb.setMeta(KEY, config); window.dispatchEvent(new Event('cockpit-backup')); }
export function backupSupported() { return 'showDirectoryPicker' in window; }
export async function chooseBackupFolder() {
  const picker = (window as unknown as { showDirectoryPicker(o: unknown): Promise<Directory> }).showDirectoryPicker;
  const directory = await picker({ mode: 'readwrite', id: 'cockpit-backup' });
  for (const name of ['01_案件データ_暗号化', '02_録音・動画原本', '03_復元手順・検証記録']) await directory.getDirectoryHandle(name, { create: true });
  await saveConfig({ directory, enabled: true, message: '保存先を設定しました。初回保存を実行してください。' });
}
export async function pauseBackup() { const c = await getBackupConfig(); if (c) await saveConfig({ ...c, enabled: false }); }
export async function permitBackup() { const c = await getBackupConfig(); if (!c) throw new Error('保存先を選択してください'); if (await c.directory.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('フォルダーへの保存許可が必要です'); await saveConfig({ ...c, enabled: true }); }
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
function mediaName(meta: RecordingMeta) { return `${encodeURIComponent(meta.id)}--${meta.name.replace(/[\\/:*?"<>|]/g, '_').slice(-120)}`; }
async function originalExists(dir: FileSystemDirectoryHandle, meta: RecordingMeta) {
  try {
    const file = await (await dir.getFileHandle(mediaName(meta))).getFile();
    const manifest = JSON.parse(await (await (await dir.getFileHandle(`${encodeURIComponent(meta.id)}.json`)).getFile()).text());
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
export async function archiveOriginal(meta: RecordingMeta, file: File) {
  const config = await getBackupConfig();
  if (!config?.enabled) return false;
  await navigator.locks.request('cockpit-auto-backup', async () => {
    if (await config.directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('自動バックアップ設定から保存許可を更新してください');
    const dir = await config.directory.getDirectoryHandle('02_録音・動画原本', { create: true });
    try {
      await saveOriginal(dir, meta, file);
      await saveConfig({ ...config, last: undefined, message: '原本を保存しました。案件データの次回保存を待っています。' });
    } catch (error) {
      await saveConfig({ ...config, last: undefined, message: '原本バックアップ未完了。設定から元ファイルを再選択してください。' });
      throw error;
    }
  });
  return true;
}
export async function runBackup(force = false) {
  return navigator.locks.request('cockpit-auto-backup', { ifAvailable: true }, async lock => {
    if (!lock) return;
    const config = await getBackupConfig();
    if (!config?.enabled || (!force && config.last && Date.now() - config.last < DAY)) return;
    if (!vaultStore.getState()) return;
    try {
      if (await config.directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('保存権限が必要です。「保存を許可して今すぐ実行」を押してください');
      await vaultStore.flushPending();
      const state = structuredClone(vaultStore.getState());
      if (!state) return;
      const text = await buildEncryptedBackup(state);
      // Verify decryption before accepting this generation as recoverable.
      const restored = JSON.parse(await decryptBackup(text));
      if (JSON.stringify(restored.state) !== JSON.stringify(state)) throw new Error('復元検証に失敗しました');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8);
      const records = await config.directory.getDirectoryHandle('01_案件データ_暗号化', { create: true });
      await writeVerified(records, `cockpit-${stamp}.json`, new Blob([text]));
      const originals = await config.directory.getDirectoryHandle('02_録音・動画原本', { create: true });
      let missing = 0;
      for (const c of state.cases) for (const r of c.recordings ?? []) {
        if (!vaultStore.getState()) throw new Error('施錠されたため原本の保存を中断しました');
        if (await originalExists(originals, r)) continue;
        try {
          if (r.sourceOnly) { missing++; continue; }
          await saveOriginal(originals, r, await vaultStore.readMediaBlob(r.id, r.mimeType));
        } catch { missing++; }
      }
      const docs = await config.directory.getDirectoryHandle('03_復元手順・検証記録', { create: true });
      await writeVerified(docs, '復元手順.txt', new Blob([RESTORE]));
      await writeVerified(docs, `${stamp}.json`, new Blob([JSON.stringify({ at: stamp, recordsVerified: true, missingOriginals: missing, cloudUploadVerified: false })]));
      await saveConfig({ ...config, last: Date.now(), missing, message: missing ? `案件データ保存済み。原本${missing}件が未保存です（全体バックアップ未完了）。` : '案件データ・登録済み原本の保存と読戻し検証が完了しました。Driveの同期完了は別途確認してください。' });
    } catch (error) {
      await saveConfig({ ...config, message: `バックアップ未完了：${error instanceof Error ? error.message : String(error)}` });
    }
  });
}
const RESTORE = `Cockpit 自動バックアップ\n01の最新のJSONをCockpit設定のバックアップ読込から選び、保存時の金庫パスフレーズで復元してください。パスフレーズはこのフォルダーとは別に保管してください。\n02には暗号化していない録音・動画原本と検証用JSONを保存します。原本は該当案件の録音・動画から再取り込みできます（別の録音として追加されます）。\n03の日付別検証記録でmissingOriginalsが0か確認してください。0以外なら原本の再選択が必要です。\nMacの故障に備え、Google Driveのアップロード完了を確認してください。アプリはクラウドへの転送完了までは確認できません。\n自動保存はこのMacでCockpitを開いて解錠している間に24時間ごと。閉じている間・スリープ中は保存されず、次回解錠時に再開します。世代の自動削除は行いません。\nブラウザー内の未同期データを含む案件情報と登録済み録音・動画を対象にします。Mac全体、他アプリ、登録していないファイル、ログイン用秘密情報は対象外です。\n`;
