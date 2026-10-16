/**
 * 金庫の暗号レイヤー。
 *
 * 設計上の約束
 * ------------------------------------------------------------------
 * 1. 金庫鍵はパスフレーズから PBKDF2-SHA256 600,000回 で導出する。
 *    （v3 は 100,000回。総当たりコストを 6 倍に引き上げた）
 * 2. 導出した鍵はメモリ上の CryptoKey としてのみ保持し、
 *    localStorage / IndexedDB / Cookie / サーバーへは一切書かない。
 *    extractable: false で生成するため、JS からも鍵の生バイト列は取り出せない。
 * 3. 暗号化は AES-GCM 256bit。iv はレコードごとに毎回 12byte の乱数を作る。
 *    （同じ iv を再利用すると GCM は平文が漏れる。使い回しは絶対にしない）
 * 4. サーバーへ送るのは ciphertext と iv だけ。鍵もパスフレーズも送らない。
 *
 * Web / Desktop / Mobile(Expo) すべてで Web Crypto API を使う。
 */

export const KDF_ALGO = "PBKDF2-SHA256";
export const KDF_ITERATIONS = 600_000;
const AES_LENGTH = 256;
const IV_BYTES = 12;
const SALT_BYTES = 32;

/** パスフレーズ照合用の既知平文。これを金庫鍵で暗号化した結果を検証トークンとする。 */
const VERIFIER_PLAINTEXT = "consulting-cockpit-v4:vault-verifier:v1";

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      "この環境では Web Crypto API が使えません。HTTPS もしくは localhost で開いてください。",
    );
  }
  return c.subtle;
}

export function randomBytes(len: number): Uint8Array {
  const b = new Uint8Array(len);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) {
    s += String.fromCharCode(...b.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function newSalt(): string {
  return toBase64(randomBytes(SALT_BYTES));
}

/**
 * パスフレーズ → 金庫鍵。
 * onProgress は導出中の待ち時間（数百ms〜数秒）にUIを出すためのフック。
 */
export async function deriveVaultKey(
  passphrase: string,
  saltB64: string,
  iterations: number = KDF_ITERATIONS,
): Promise<CryptoKey> {
  const s = subtle();
  const baseKey = await s.importKey(
    "raw",
    enc.encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return s.deriveKey(
    {
      name: "PBKDF2",
      salt: fromBase64(saltB64) as unknown as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: AES_LENGTH },
    // extractable: false — 鍵の生バイト列を JS 側へ取り出せないようにする
    false,
    ["encrypt", "decrypt"],
  );
}

export interface Sealed {
  ciphertext: string;
  iv: string;
}
/**
 * パスフレーズ → 金庫鍵＋指紋鍵（HMAC）の2本。
 *
 * 指紋鍵の使い道：保存レコードの「平文の指紋」を HMAC-SHA256 で作る。
 * 以前は鍵なしの速いハッシュ（cyrb53）を保存していて、保存領域を読める相手が
 * 「候補を当てはめて一致するか」を鍵なしで確かめられてしまった。
 * HMAC にすることで、金庫を解錠しない限り照合できない。
 * 指紋鍵はメモリ上にだけ置き、永続化しない。
 */
export async function deriveVaultKeys(
  passphrase: string,
  saltB64: string,
  iterations: number = KDF_ITERATIONS,
): Promise<{ vaultKey: CryptoKey; macKey: CryptoKey }> {
  const s = subtle();
  const baseKey = await s.importKey(
    "raw",
    enc.encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const params = {
    name: "PBKDF2",
    salt: fromBase64(saltB64) as unknown as BufferSource,
    iterations,
    hash: "SHA-256",
  };
  const vaultKey = await s.deriveKey(
    params,
    baseKey,
    { name: "AES-GCM", length: AES_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
  const macKey = await s.deriveKey(
    { ...params, salt: enc.encode("cc4:fingerprint:v2:" + saltB64) },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  return { vaultKey, macKey };
}

/**
 * 平文の指紋（HMAC-SHA256 の16進）。レコードの変更検知に使う。
 * 鍵がないと作れないので、保存領域だけを読む相手は候補照合ができない。
 */
export async function hmacHex(macKey: CryptoKey, text: string): Promise<string> {
  const buf = await subtle().sign("HMAC", macKey, enc.encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}


/**
 * 付帯情報（AAD）。封と「どのレコードのものか」を結び付ける。
 * これがあると、暗号文を別のレコードへ差し替えても復号が失敗する。
 */
function aadBytes(aad?: string): BufferSource | undefined {
  return aad ? (enc.encode(aad) as unknown as BufferSource) : undefined;
}

/**
 * AES-GCM のアルゴリズム引数を組み立てる。
 * additionalData は undefined のまま渡すと WebIDL の型検査で
 * "Not a BufferSource" になるため、aad があるときだけキーを載せる。
 */
function gcmParams(iv: BufferSource, aad?: string): AesGcmParams {
  const params: AesGcmParams = { name: "AES-GCM", iv };
  const a = aadBytes(aad);
  if (a) params.additionalData = a;
  return params;
}

/** 任意の JSON 値を封をして返す */
export async function seal(key: CryptoKey, value: unknown, aad?: string): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const buf = await subtle().encrypt(
    gcmParams(iv as unknown as BufferSource, aad),
    key,
    enc.encode(JSON.stringify(value)),
  );
  return { ciphertext: toBase64(buf), iv: toBase64(iv) };
}

/**
 * 封を開ける。鍵違い・改ざん時は例外になる（GCM の認証タグが不一致になる）。
 * aad を渡すと付帯情報も一致しないと開かない。
 * legacyOk を true にすると、AAD 導入前の古い封（AAD なし）も開ける。
 * 古い封は次回保存時に新形式へ封じ直される。
 */
export async function open<T = unknown>(
  key: CryptoKey,
  sealed: Sealed,
  aad?: string,
  legacyOk = false,
): Promise<T> {
  let buf: ArrayBuffer;
  try {
    buf = await subtle().decrypt(
      gcmParams(fromBase64(sealed.iv) as unknown as BufferSource, aad),
      key,
      fromBase64(sealed.ciphertext) as unknown as BufferSource,
    );
  } catch (e) {
    if (!legacyOk || !aad) throw e;
    buf = await subtle().decrypt(
      gcmParams(fromBase64(sealed.iv) as unknown as BufferSource),
      key,
      fromBase64(sealed.ciphertext) as unknown as BufferSource,
    );
  }
  return JSON.parse(dec.decode(buf)) as T;
}

/**
 * バイナリをそのまま封をする（録画・録音のチャンク用）。
 * base64 を通さないので容量が膨らまない。戻り値は IndexedDB に直接置く。
 */
export async function sealBytes(
  key: CryptoKey,
  data: ArrayBuffer,
  aad?: string,
): Promise<{ iv: ArrayBuffer; data: ArrayBuffer }> {
  const iv = randomBytes(IV_BYTES);
  const buf = await subtle().encrypt(
    gcmParams(iv as unknown as BufferSource, aad),
    key,
    data,
  );
  return { iv: iv.buffer as ArrayBuffer, data: buf };
}

/**
 * sealBytes の逆。鍵違い・改ざん時は例外になる。
 * legacyOk を true にすると AAD 導入前のチャンク（AAD なし）も開ける。
 */
export async function openBytes(
  key: CryptoKey,
  chunk: { iv: ArrayBuffer; data: ArrayBuffer },
  aad?: string,
  legacyOk = false,
): Promise<ArrayBuffer> {
  try {
    return await subtle().decrypt(
      gcmParams(chunk.iv, aad),
      key,
      chunk.data,
    );
  } catch (e) {
    if (!legacyOk || !aad) throw e;
    return subtle().decrypt(gcmParams(chunk.iv), key, chunk.data);
  }
}

/** 新しい金庫を作るときの検証トークン */
export async function buildVerifier(key: CryptoKey): Promise<Sealed> {
  return seal(key, VERIFIER_PLAINTEXT);
}

/** パスフレーズが正しいかを、サーバーの検証トークンで確認する */
export async function checkVerifier(key: CryptoKey, sealed: Sealed): Promise<boolean> {
  try {
    const v = await open<string>(key, sealed);
    return v === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

/** SHA-256 の16進文字列（監査ログのハッシュ連鎖に使う） */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await subtle().digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 鍵の指紋。同一鍵かどうかを鍵そのものを晒さずに比較するため。 */
export async function keyFingerprint(key: CryptoKey, saltB64: string): Promise<string> {
  const probe = await seal(key, "fingerprint-probe");
  return (await sha256Hex(saltB64 + probe.iv)).slice(0, 16);
}
