import { describe, expect, test } from "bun:test";
import {
  MAX_SYNC_PAGE_BYTES,
  MAX_SYNC_PAGE_ROWS,
  SYNC_ROW_OVERHEAD,
  selectSyncPage,
} from "../packages/web/src/shared/sync-page";
const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: String(i), seq: i + 1, bytes: 100 }));
describe("bounded sync page", () => {
  test("empty pages retain cursor", () =>
    expect(selectSyncPage([], 42)).toEqual({ ids: [], cursor: 42, hasMore: false }));
  test("lookahead bounds row count without skipping it", () => {
    const page = selectSyncPage(rows(MAX_SYNC_PAGE_ROWS + 1), 0);
    expect(page.ids.length).toBe(MAX_SYNC_PAGE_ROWS);
    expect(page.cursor).toBe(MAX_SYNC_PAGE_ROWS);
    expect(page.hasMore).toBe(true);
  });
  test("legacy ties straddling the boundary are deferred together", () => {
    const input = rows(MAX_SYNC_PAGE_ROWS + 1);
    input.at(-1)!.seq = input.at(-2)!.seq;
    const page = selectSyncPage(input, 0);
    expect(page.ids.length).toBe(MAX_SYNC_PAGE_ROWS - 1);
    expect(page.cursor).toBe(MAX_SYNC_PAGE_ROWS - 1);
  });
  test("an oversized legacy tie group refuses rather than advancing", () => {
    expect(() =>
      selectSyncPage(
        rows(MAX_SYNC_PAGE_ROWS + 1).map((r) => ({ ...r, seq: 1 })),
        0,
      ),
    ).toThrow("SYNC_PAGE_GROUP_TOO_LARGE");
  });
  test("byte bound includes overhead and defers whole groups", () => {
    const input = rows(3).map((r) => ({
      ...r,
      bytes: MAX_SYNC_PAGE_BYTES / 2 - SYNC_ROW_OVERHEAD,
    }));
    expect(selectSyncPage(input, 0)).toEqual({ ids: ["0", "1"], cursor: 2, hasMore: true });
    input[1].seq = input[2].seq;
    expect(selectSyncPage(input, 0)).toEqual({ ids: ["0"], cursor: 1, hasMore: true });
  });
});
