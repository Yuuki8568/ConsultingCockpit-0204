/**
 * モバイル版の暗号レイヤー。
 *
 * なぜ Web と実装が違うのか
 * ------------------------------------------------------------------
 * ブラウザ版は Web Crypto API（crypto.subtle）を使っているが、
 * React Native の実行環境には crypto.subtle がない。
 * そこで、鍵の作り方（PBKDF2-SHA256 600,000回）と
 * 暗号方式（AES-GCM 256bit）はブラウザ版と完全に同じまま、
 * 計算だけ @noble のライブラリで行う。
 * 同じ金庫を両方から開けるように、仕様は1ビットも変えていない。
 *
 * 鍵の扱い
 * ------------------------------------------------------------------
 * PBKDF2 を60万回まわす計算は、携帯電話では数秒から十数秒かかる。
 * 毎回これを待つのは実用的でないため、
 *   1回目: パスフレーズを入力 → 鍵を作る（時間がかかる。進捗を出す）
 *   2回目以降: 端末の安全な保管領域（Keychain / Keystore）から鍵を出す。
 *              取り出しには生体認証か端末のパスコードを要求する。
 * という形にしている。鍵は OS の保管領域にしか置かず、
 * 通常のファイルや AsyncStorage には書かない。
 */
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes as nobleRandom } from "@noble/ciphers/utils.js";
import * as SecureStore from "expo-secure-store";

export const KDF_ITERATIONS = 600_000;
const IV_BYTES = 12;
const VERIFIER_PLAINTEXT = "consulting-cockpit-v4:vault-verifier:v1";
const KEY_SLOT = "cockpit_vault_key";
const SALT_SLOT = "cockpit_vault_salt";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return globalThis.btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = globalThis.atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  return nobleRandom(n);
}

/**
 * パスフレーズから金庫鍵を作る。
 * onProgress は 0〜1 で進み具合を返す（画面に出して待ち時間を伝えるため）。
 */
export async function deriveVaultKey(
  passphrase: string,
  saltB64: string,
  iterations: number = KDF_ITERATIONS,
  onProgress?: (ratio: number) => void,
): Promise<Uint8Array> {
  return pbkdf2Async(sha256, passphrase.normalize("NFKC"), fromBase64(saltB64), {
    c: iterations,
    dkLen: 32,
    asyncTick: 30,
  }).then((k) => {
    onProgress?.(1);
    return k;
  });
}

export interface Sealed {
  ciphertext: string;
  iv: string;
}

export function seal(key: Uint8Array, value: unknown): Sealed {
  const iv = randomBytes(IV_BYTES);
  const ct = gcm(key, iv).encrypt(enc.encode(JSON.stringify(value)));
  return { ciphertext: toBase64(ct), iv: toBase64(iv) };
}

export function open<T = unknown>(key: Uint8Array, sealed: Sealed): T {
  const pt = gcm(key, fromBase64(sealed.iv)).decrypt(fromBase64(sealed.ciphertext));
  return JSON.parse(dec.decode(pt)) as T;
}

export function checkVerifier(key: Uint8Array, sealed: Sealed): boolean {
  try {
    return open<string>(key, sealed) === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

/** 端末の安全な保管領域に鍵を預ける（取り出しに生体認証を要求する） */
export async function rememberKey(key: Uint8Array, saltB64: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_SLOT, toBase64(key), {
    requireAuthentication: true,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.setItemAsync(SALT_SLOT, saltB64);
}

/** 預けた鍵を取り出す。生体認証か端末のパスコードが要求される。 */
export async function recallKey(): Promise<{ key: Uint8Array; salt: string } | null> {
  try {
    const k = await SecureStore.getItemAsync(KEY_SLOT, { requireAuthentication: true });
    const s = await SecureStore.getItemAsync(SALT_SLOT);
    if (!k || !s) return null;
    return { key: fromBase64(k), salt: s };
  } catch {
    // 認証を断られた場合もここに来る
    return null;
  }
}

export async function hasRememberedKey(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(SALT_SLOT)) != null;
  } catch {
    return false;
  }
}

export async function forgetKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_SLOT);
    await SecureStore.deleteItemAsync(SALT_SLOT);
  } catch {
    /* 消せなくても続行する */
  }
}
