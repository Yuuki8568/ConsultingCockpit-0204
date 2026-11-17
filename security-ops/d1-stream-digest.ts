/** Internal v2 streaming format. Deliberately incompatible with the v1 array
 * manifest and activation receipt. Hashes/rows remain private operational data.
 */
export const STREAM_FORMAT = "cockpit-d1-stream-v2";
const encoder = new TextEncoder();
export async function streamDigest(value: unknown): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(value)))),
    b => b.toString(16).padStart(2, "0")).join("");
}
export function streamStart(runId: string, schemaHash: string, scopeHash: string) {
  return streamDigest([STREAM_FORMAT, "start", runId, schemaHash, scopeHash]);
}
export function streamRow(previous: string, tableIndex: number, values: readonly (string | number | null)[]) {
  return streamDigest([STREAM_FORMAT, "row", previous, tableIndex, values]);
}
export function streamBoundary(previous: string, tableIndex: number, tableRows: number, totalRows: number, totalBytes: number) {
  return streamDigest([STREAM_FORMAT, "table-end", previous, tableIndex, tableRows, totalRows, totalBytes]);
}
