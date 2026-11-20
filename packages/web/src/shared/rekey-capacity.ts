/** Client preflight, not a substitute for server validation or commit-time CAS. */
export function assertRekeyCapacity<T extends { records: { ciphertext: string }[] }>(
  request: T,
  backend: "libsql" | "d1",
) {
  if (request.records.length > (backend === "d1" ? 1000 : 5000))
    throw new Error("現在の鍵変更の件数上限を超えています。原本と現在の鍵を保持して処理を停止しました。");
  if (request.records.some(row => row.ciphertext.length > 1_048_576))
    throw new Error("鍵変更できる1件の容量を超えています。原本と現在の鍵を保持して処理を停止しました。");
  // Allow for the one-time authorization UUID and RPC transport envelope.
  // Refuse conservatively before writing a recovery journal that cannot be sent.
  const bytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
  if (bytes > 4 * 1024 * 1024 - 16 * 1024)
    throw new Error("現在の鍵変更の送信容量を超えています。分割対応が必要なため、原本と現在の鍵を保持して処理を停止しました。");
}
