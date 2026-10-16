import { deriveVaultKey, newSalt, seal, open, buildVerifier, checkVerifier, KDF_ITERATIONS } from "./packages/web/src/web/lib/crypto/vault-crypto";
const salt = newSalt();
const t0 = Date.now();
const key = await deriveVaultKey("correct horse battery staple 2026", salt);
console.log("KDF iterations:", KDF_ITERATIONS, "derive ms:", Date.now() - t0);
console.log("key.extractable:", key.extractable, "algo:", JSON.stringify(key.algorithm));
const v = await buildVerifier(key);
console.log("verifier ok (right passphrase):", await checkVerifier(key, v));
const wrong = await deriveVaultKey("wrong passphrase", salt);
console.log("verifier ok (wrong passphrase):", await checkVerifier(wrong, v));
const s1 = await seal(key, { company: "テスト株式会社", amount: 150000 });
const s2 = await seal(key, { company: "テスト株式会社", amount: 150000 });
console.log("same plaintext -> same iv?", s1.iv === s2.iv, "same ciphertext?", s1.ciphertext === s2.ciphertext);
console.log("ciphertext contains plaintext?", s1.ciphertext.includes("テスト"), atob(s1.ciphertext).includes("company"));
// tamper
const raw = atob(s1.ciphertext).split("");
raw[3] = String.fromCharCode(raw[3].charCodeAt(0) ^ 1);
const tampered = { ciphertext: btoa(raw.join("")), iv: s1.iv };
try { await open(key, tampered); console.log("tampered decrypt: SUCCEEDED (bad)"); }
catch (e) { console.log("tampered decrypt: rejected ->", (e as Error).name); }
// wrong key decrypt
try { await open(wrong, s1); console.log("wrong-key decrypt: SUCCEEDED (bad)"); }
catch (e) { console.log("wrong-key decrypt: rejected ->", (e as Error).name); }
