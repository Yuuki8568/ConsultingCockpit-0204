/** Encrypted records backup. Media bodies are excluded. Format 2 carries public KDF
 * parameters; recovery requires the passphrase in use at export time. Legacy format 1
 * still requires the original unlocked vault or separately retained KDF parameters. */
import { recoverPortableBackup, parsePortableBackup } from "./backup-format";
import type { VaultState } from "../../domain/types";
import { vaultStore } from "../store/vault-store";

export const BACKUP_KIND = "encrypted-backup";
export const BACKUP_FORMAT = 2;

interface EncryptedBackupFile {
  app: "consulting-cockpit";
  kind: typeof BACKUP_KIND;
  format: number;
  exportedAt: string;
  kdf?: { algorithm: "PBKDF2-SHA256"; salt: string; iterations: number };
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
    kdf: { algorithm: "PBKDF2-SHA256", ...vaultStore.getBackupKdf() },
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
export async function decryptBackup(text: string, passphrase?: string): Promise<string> {
  const j = JSON.parse(text) as EncryptedBackupFile;
  if (j.app !== "consulting-cockpit" || j.kind !== BACKUP_KIND) {
    throw new Error("このファイルは暗号化された控えではありません");
  }
  if (j.format === 2) {
    parsePortableBackup(text);
    if (passphrase) return recoverPortableBackup(text, passphrase);
  }
  if (j.format !== 1 && j.format !== BACKUP_FORMAT) {
    throw new Error(`この控えの形式（${j.format}）には対応していません`);
  }
  const payload = await vaultStore.openBackup<unknown>({ ciphertext: j.ciphertext, iv: j.iv });
  return JSON.stringify(payload);
}