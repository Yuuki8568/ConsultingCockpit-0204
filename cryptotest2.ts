import { deriveVaultKey, newSalt, seal, open, buildVerifier, checkVerifier, fromBase64 } from "./packages/web/src/web/lib/crypto/vault-crypto";
const salt = newSalt();
console.log("salt bytes:", fromBase64(salt).length);
const t0 = Date.now();
const k = await deriveVaultKey("Correct-Passphrase-2026!", salt);
console.log("G1 鍵導出時間(ms):", Date.now() - t0, "extractable:", k.extractable, "algo:", JSON.stringify(k.algorithm), "usages:", k.usages.join(","));
const wrong = await deriveVaultKey("correct-passphrase-2026!", salt);
const ver = await buildVerifier(k);
console.log("G2 正しいパスフレーズで照合:", await checkVerifier(k, ver));
console.log("G3 大文字違いのパスフレーズで照合:", await checkVerifier(wrong, ver));
const otherSalt = newSalt();
const k2 = await deriveVaultKey("Correct-Passphrase-2026!", otherSalt);
console.log("G4 同じパスフレーズ・別saltで照合:", await checkVerifier(k2, ver));
const plain = { company: "サンプル株式会社", fee: 150000, memo: "面談メモ" };
const s1 = await seal(k, plain);
const s2 = await seal(k, plain);
console.log("G5 同じ平文2回封印 iv一致?:", s1.iv === s2.iv, " ciphertext一致?:", s1.ciphertext === s2.ciphertext, " iv bytes:", fromBase64(s1.iv).length);
const ivs = new Set<string>();
for (let i = 0; i < 200; i++) ivs.add((await seal(k, i)).iv);
console.log("G6 200回封印の iv 重複数:", 200 - ivs.size);
console.log("G7 暗号文に平文が現れるか:", /サンプル|150000|面談/.test(atob(s1.ciphertext)) ? "現れる" : "現れない");
// 改ざん
const raw = fromBase64(s1.ciphertext);
raw[3] ^= 0x01;
const tampered = { ciphertext: Buffer.from(raw).toString("base64"), iv: s1.iv };
try { await open(k, tampered); console.log("G8 1bit改ざんの復号: 成功してしまった"); } catch { console.log("G8 1bit改ざんの復号: 失敗（検知）"); }
try { await open(wrong, s1); console.log("G9 別鍵での復号: 成功してしまった"); } catch { console.log("G9 別鍵での復号: 失敗（正常）"); }
try { await open(k, { ciphertext: s1.ciphertext, iv: s2.iv }); console.log("G10 iv差し替え復号: 成功してしまった"); } catch { console.log("G10 iv差し替え復号: 失敗（正常）"); }
console.log("G11 復号結果一致:", JSON.stringify(await open(k, s1)) === JSON.stringify(plain));
try { // 鍵の書き出し可否
  // @ts-expect-error 意図的
  const ex = await crypto.subtle.exportKey("raw", k); console.log("G12 鍵の書き出し:", ex ? "できてしまった" : "?");
} catch { console.log("G12 鍵の書き出し: 拒否された（extractable:false）"); }
