// SQLite hex() returns uppercase ASCII. Check the whole bounded input before
// decoding, including characters that a permissive decoder might ignore.
const bytesConstructor = Uint8Array as typeof Uint8Array & {
  fromHex?: (value: string) => Uint8Array<ArrayBuffer>;
};

export function decodeSqliteHex(value: unknown, maxBytes: number): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== "string" || value.length > maxBytes * 2 ||
      value.length % 2 !== 0 || /[^0-9A-F]/.test(value)) return null;
  if (bytesConstructor.fromHex) return bytesConstructor.fromHex(value);
  const bytes = new Uint8Array(value.length / 2);
  // Only '0'..'9' and 'A'..'F' remain. Their character codes map directly
  // to the two four-bit values without allocating a substring for each byte.
  for (let i = 0; i < bytes.length; i++) {
    const high = value.charCodeAt(i * 2), low = value.charCodeAt(i * 2 + 1);
    bytes[i] = ((high - (high <= 57 ? 48 : 55)) << 4) | (low - (low <= 57 ? 48 : 55));
  }
  return bytes;
}
