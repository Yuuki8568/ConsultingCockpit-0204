/**
 * 控え（バックアップ）の暗号化ファイル形式。
 *
 * 中身は「金庫と同じ鍵」で封をした JSON。ファイルだけでは読めず、
 * 復元にはその金庫のパスフレーズが要る。認証基盤（サインイン）が
 * 使えなくても、パスフレーズさえあれば別端末で復元できる。
 *
 * 録画・録音の本体は含まれない（端末ローカルの別領域に置いてあるため）。
 * 画面上もその旨を明示する。
 */
import type { VaultState } from "../../domain/types";
import { vaultStore } from "../store/vault-store";

export const BACKUP_KIND = "encrypted-backup";
export const BACKUP_FORMAT = 1;

interface EncryptedBackupFile {
  app: "consulting-cockpit";
  kind: typeof BACKUP_KIND;
  format: number;
  exportedAt: string;
  iv: string;
  ciphertext: string;
}

/** いまの金庫の内容を、暗号化した控えファイルの本文にする */
export async function buildEncryptedBackup(state: VaultState): Promise<string> {
  const payload = {
    app: "consulting-cockpit",
    version: 4,
    exportedAt: new Date().toISOString(),
    state,
  };
  const sealed = await vaultStore.sealBackup(payload);
  const file: EncryptedBackupFile = {
    app: "consulting-cockpit",
    kind: BACKUP_KIND,
    format: BACKUP_FORMAT,
    exportedAt: payload.exportedAt,
    iv: sealed.iv,
    ciphertext: sealed.ciphertext,
  };
  return JSON.stringify(file);
}

/** 読み込んだテキストが暗号化された控えかどうか */
export function isEncryptedBackup(text: string): boolean {
  try {
    const j = JSON.parse(text) as Partial<EncryptedBackupFile>;
    return j.app === "consulting-cockpit" && j.kind === BACKUP_KIND;
  } catch {
    return false;
  }
}

/**
 * 暗号化された控えを開き、中の JSON テキスト（previewImport / importVaultState に
 * そのまま渡せる形）を返す。鍵が違う・改ざんされている場合は例外になる。
 */
export async function decryptBackup(text: string): Promise<string> {
  const j = JSON.parse(text) as EncryptedBackupFile;
  if (j.app !== "consulting-cockpit" || j.kind !== BACKUP_KIND) {
    throw new Error("このファイルは暗号化された控えではありません");
  }
  if (j.format !== BACKUP_FORMAT) {
    throw new Error(`この控えの形式（${j.format}）には対応していません`);
  }
  const payload = await vaultStore.openBackup<unknown>({ ciphertext: j.ciphertext, iv: j.iv });
  return JSON.stringify(payload);
}