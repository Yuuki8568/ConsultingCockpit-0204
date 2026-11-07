export interface TranscriptionCheckpoint {
  version: 1;
  fingerprint: string;
  completedSeconds: number;
  totalSeconds: number;
}
/** Hash bounded pieces, then hash their digests. Every byte contributes without a whole-file allocation. */
export async function fingerprint(blob: Blob, signal: AbortSignal): Promise<string> {
  const hashes: Uint8Array[] = [];
  for (let offset = 0; offset < blob.size; offset += 8 * 1024 * 1024) {
    signal.throwIfAborted();
    const piece = await blob.slice(offset, offset + 8 * 1024 * 1024).arrayBuffer();
    hashes.push(new Uint8Array(await crypto.subtle.digest('SHA-256', piece)));
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(hashes.length * 32);
  hashes.forEach((hash, i) => bytes.set(hash, i * 32));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `v1:${blob.size}:${Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')}`;
}
