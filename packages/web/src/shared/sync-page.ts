/** Bounded numeric-cursor pages. Legacy equal-sequence rows must travel together. */
export const MAX_SYNC_PAGE_ROWS = 256;
export const MAX_SYNC_PAGE_BYTES = 4 * 1024 * 1024;
export const SYNC_ROW_OVERHEAD = 1024;
export type SyncPageMetadata = { id: string; seq: number; bytes: number };

export function selectSyncPage(rows: SyncPageMetadata[], since: number) {
  let end = 0;
  let bytes = 0;
  while (end < rows.length) {
    let groupEnd = end + 1;
    let groupBytes = rows[end].bytes + SYNC_ROW_OVERHEAD;
    while (groupEnd < rows.length && rows[groupEnd].seq === rows[end].seq) {
      groupBytes += rows[groupEnd].bytes + SYNC_ROW_OVERHEAD;
      groupEnd++;
    }
    // The extra metadata row is a lookahead, never part of the page. Its group
    // may continue beyond the query, so do not advance the cursor through it.
    if (groupEnd > MAX_SYNC_PAGE_ROWS || bytes + groupBytes > MAX_SYNC_PAGE_BYTES) break;
    bytes += groupBytes;
    end = groupEnd;
  }
  if (rows.length && !end) throw new Error("SYNC_PAGE_GROUP_TOO_LARGE");
  return {
    ids: rows.slice(0, end).map((r) => r.id),
    cursor: end ? rows[end - 1].seq : since,
    hasMore: end < rows.length,
  };
}
