import { deriveVaultKey, open, type Sealed } from "../crypto/vault-crypto";
export interface PortableBackup extends Sealed {
  app: "consulting-cockpit";
  kind: "encrypted-backup";
  format: 2;
  exportedAt: string;
  kdf: { algorithm: "PBKDF2-SHA256"; salt: string; iterations: number };
}
export function parsePortableBackup(text: string): PortableBackup {
  if (text.length > 100 * 1024 * 1024) throw new Error("バックアップが大きすぎます");
  const j = JSON.parse(text);
  if (j.app !== "consulting-cockpit" || j.kind !== "encrypted-backup" || j.format !== 2 ||
      j.kdf?.algorithm !== "PBKDF2-SHA256" || !Number.isSafeInteger(j.kdf.iterations) ||
      j.kdf.iterations < 100000 || j.kdf.iterations > 2000000 ||
      typeof j.kdf.salt !== "string" || atob(j.kdf.salt).length !== 32 ||
      typeof j.iv !== "string" || atob(j.iv).length !== 12 || typeof j.ciphertext !== "string")
    throw new Error("バックアップ形式が不正です");
  return j;
}
/** Fully offline; no authentication service or current vault key is needed. */
export async function recoverPortableBackup(text: string, passphrase: string): Promise<string> {
  const j = parsePortableBackup(text);
  const key = await deriveVaultKey(passphrase, j.kdf.salt, j.kdf.iterations);
  return JSON.stringify(await open(key, j, "cc4-backup"));
}
