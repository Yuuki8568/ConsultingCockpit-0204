import { sql } from "drizzle-orm";

// Bound ciphertext transfer independently of row count. The cursor is an
// independently witnessed sequence, never an offset that can skip deletions.
export const WITNESS_PAGE_ROWS = 1000;
export const WITNESS_PAGE_BYTES = 2 * 1024 * 1024;
export const WITNESS_ROW_OVERHEAD = 1024;
export const witnessPayloadBytes = sql<number>`coalesce(length(CAST(payload_ciphertext AS BLOB)),0)+coalesce(length(CAST(payload_iv AS BLOB)),0)`;
export type WitnessMetadata = { seq: number; hash: string; bytes: number };

export function selectWitnessPage(metadata: WitnessMetadata[], since: number) {
  let bytes = 0;
  let end = 0;
  for (const row of metadata) {
    if (!Number.isSafeInteger(row.bytes) || row.bytes < 0 ||
        row.seq !== since + end + 1) throw new Error("Audit chain mismatch");
    if (end === WITNESS_PAGE_ROWS || bytes + row.bytes + WITNESS_ROW_OVERHEAD > WITNESS_PAGE_BYTES) break;
    bytes += row.bytes + WITNESS_ROW_OVERHEAD;
    end++;
  }
  if (metadata.length && !end) throw new Error("Audit event exceeds verification page capacity");
  return {
    rows: metadata.slice(0, end),
    cursor: end ? metadata[end - 1].seq : since,
    hasMore: end < metadata.length,
  };
}

/** Recheck the range's size inside the payload query, not just in a prior read. */
export function witnessPageSizeGate(userId: string, since: number, until: number) {
  return sql`(SELECT coalesce(sum(${witnessPayloadBytes}+${WITNESS_ROW_OVERHEAD}),0)
    FROM audit_event WHERE user_id=${userId} AND seq>${since} AND seq<=${until})<=${WITNESS_PAGE_BYTES}`;
}
