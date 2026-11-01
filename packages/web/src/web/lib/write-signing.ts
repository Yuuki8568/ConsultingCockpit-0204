import { client } from "./api";
import { seal, open, toBase64 } from "./crypto/vault-crypto";
import { authorize } from "./step-up";
import { operationHash, signingMessage } from "../../shared/operation-proof";
const aad = "cockpit-write-private-v1";
export async function setupWriteSigning(key: CryptoKey, generation: number) {
  const current = await client.writeKeys.current();
  if (current) {
    if (current.generation !== generation) throw new Error("鍵の世代が変わっています。再読み込みして金庫を解錠してください。");
    // A second device reuses the vault-encrypted identity instead of rotating it.
    const privateJwk = await open<JsonWebKey>(key, { ciphertext: current.privateCiphertext, iv: current.privateIv }, aad);
    const privateKey = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const publicKey = await crypto.subtle.importKey("jwk", JSON.parse(current.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const probe = crypto.getRandomValues(new Uint8Array(32));
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, probe);
    if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, probe)) throw new Error("署名鍵を確認できません。管理者に連絡してください。");
    return;
  }
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const encrypted = await seal(key, priv, aad);
  const input = {
    publicKey: { kty: "EC" as const, crv: "P-256" as const, x: pub.x!, y: pub.y! },
    privateCiphertext: encrypted.ciphertext,
    privateIv: encrypted.iv,
    generation,
    expectedVersion: 0,
  };
  await client.writeKeys.register({
    ...input,
    authorization: await authorize("write-key:register", input),
  });
}
export async function signSync(key: CryptoKey, input: Parameters<typeof client.sync.push>[0]) {
  const identity = await client.writeKeys.current();
  if (!identity || identity.generation !== input.generation)
    throw new Error("設定の本人確認から書き込み署名を有効にしてください");
  const priv = await open<JsonWebKey>(
    key,
    { ciphertext: identity.privateCiphertext, iv: identity.privateIv },
    aad,
  );
  const signing = await crypto.subtle.importKey(
    "jwk",
    priv,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const challenge = await client.writeKeys.challenge({
    deviceId: input.deviceId,
    payloadHash: await operationHash(input),
  });
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signing,
    new TextEncoder().encode(signingMessage(challenge)),
  );
  return { id: challenge.id, signature: toBase64(signature) };
}
export async function rewrapWriteKey(oldKey: CryptoKey, newKey: CryptoKey) {
  const identity = await client.writeKeys.current();
  if (!identity) return undefined;
  const priv = await open<JsonWebKey>(
    oldKey,
    { ciphertext: identity.privateCiphertext, iv: identity.privateIv },
    aad,
  );
  const encrypted = await seal(newKey, priv, aad);
  return {
    privateCiphertext: encrypted.ciphertext,
    privateIv: encrypted.iv,
    expectedVersion: identity.version,
  };
}
