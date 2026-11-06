import { sql } from "drizzle-orm";
import { SYNC_ROW_OVERHEAD } from "../../shared/sync-page";

/**
 * Explicit, owner-requested aggregates only. Never call these on each sync or
 * status refresh: the database must visit the owner's rows to compute totals.
 * Every result is a count/length; no business contents or identifiers leave SQL.
 */
const selects = {
  records: `SELECT
    count(*) AS totalCount,
    coalesce(sum(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END),0) AS liveCount,
    coalesce(sum(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END),0) AS deletedCount,
    coalesce(sum(CASE WHEN deleted_at IS NULL THEN length(CAST(ciphertext AS BLOB))+length(CAST(iv AS BLOB)) ELSE 0 END),0) AS liveEncryptedBytes,
    coalesce(sum(CASE WHEN deleted_at IS NOT NULL THEN length(CAST(ciphertext AS BLOB))+length(CAST(iv AS BLOB)) ELSE 0 END),0) AS deletedEncryptedBytes,
    coalesce(max(length(CAST(ciphertext AS BLOB))),0) AS largestCiphertextBytes
    FROM record`,
  revisions: `SELECT count(*) AS count,
    coalesce(sum(length(CAST(snapshot AS BLOB))),0) AS logicalBytes
    FROM record_revision`,
  audit: `SELECT count(*) AS count,
    coalesce(sum(length(CAST(payload_ciphertext AS BLOB))),0) AS ciphertextBytes,
    coalesce(sum(coalesce(length(CAST(payload_ciphertext AS BLOB)),0)+coalesce(length(CAST(payload_iv AS BLOB)),0)),0) AS encryptedPayloadBytes
    FROM audit_event`,
} as const;

/** Raw statements for D1 .prepare(...).bind(authenticatedUserId). */
export const STORAGE_USAGE_SELECTS = {
  records: `${selects.records} WHERE user_id=?`,
  revisions: `${selects.revisions} WHERE user_id=?`,
  audit: `${selects.audit} WHERE user_id=?`,
} as const;

/** Parameterized Drizzle equivalents for the libSQL route. */
export function storageUsageQueries(userId: string) {
  return {
    records: sql`${sql.raw(selects.records)} WHERE user_id=${userId}`,
    revisions: sql`${sql.raw(selects.revisions)} WHERE user_id=${userId}`,
    audit: sql`${sql.raw(selects.audit)} WHERE user_id=${userId}`,
  };
}

type AggregateRow = Record<string, unknown>;
export type StorageCapacityLimit = {
  key: string;
  label: string;
  used: number;
  limit: number;
  unit: "records" | "bytes";
  severity: "normal" | "warning" | "critical" | "exceeded";
  /** Lower-bound values cannot establish that the actual operation will fit. */
  basis: "exact" | "lower-bound";
  note: string;
};
export type StorageUsage = {
  backend: "libsql" | "d1";
  measuredAtMs: number;
  records: {
    liveCount: number;
    deletedCount: number;
    totalCount: number;
    liveEncryptedBytes: number;
    deletedEncryptedBytes: number;
    totalEncryptedBytes: number;
    largestCiphertextBytes: number;
  };
  revisions: { count: number; logicalBytes: number };
  audit: { count: number; ciphertextBytes: number; encryptedPayloadBytes: number };
  logicalBytesTotal: number;
  limits: StorageCapacityLimit[];
};

function nonnegativeInteger(value: unknown): number {
  if (
    typeof value !== "number" &&
    typeof value !== "bigint" &&
    !(typeof value === "string" && /^\d+$/.test(value))
  ) throw new Error("STORAGE_USAGE_INVALID_AGGREGATE");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("STORAGE_USAGE_INVALID_AGGREGATE");
  return n;
}

function capacity(
  key: string,
  label: string,
  used: number,
  limit: number,
  unit: StorageCapacityLimit["unit"],
  note: string,
  basis: StorageCapacityLimit["basis"] = "exact",
): StorageCapacityLimit {
  return {
    key, label, used, limit, unit, basis, note,
    severity: used > limit ? "exceeded" : used >= limit * 0.9 ? "critical" : used >= limit * 0.7 ? "warning" : "normal",
  };
}

/**
 * These are current application bounds, NOT Cloudflare/provider plan capacity.
 * Keep aligned with sync.ts, rekey-input.ts, rekey.ts, audit.ts and bodyLimit.
 * A low figure is not proof that rekey/migration/full verification will succeed.
 * Physical DB pages, indexes, other tables and other users are not estimated.
 */
export function summarizeStorageUsage(
  backend: StorageUsage["backend"],
  recordRow: AggregateRow,
  revisionRow: AggregateRow,
  auditRow: AggregateRow,
  measuredAtMs = Date.now(),
): StorageUsage {
  const records = {
    liveCount: nonnegativeInteger(recordRow.liveCount),
    deletedCount: nonnegativeInteger(recordRow.deletedCount),
    totalCount: nonnegativeInteger(recordRow.totalCount),
    liveEncryptedBytes: nonnegativeInteger(recordRow.liveEncryptedBytes),
    deletedEncryptedBytes: nonnegativeInteger(recordRow.deletedEncryptedBytes),
    totalEncryptedBytes: 0,
    largestCiphertextBytes: nonnegativeInteger(recordRow.largestCiphertextBytes),
  };
  if (records.liveCount + records.deletedCount !== records.totalCount)
    throw new Error("STORAGE_USAGE_INVALID_AGGREGATE");
  records.totalEncryptedBytes = nonnegativeInteger(records.liveEncryptedBytes + records.deletedEncryptedBytes);
  const revisions = { count: nonnegativeInteger(revisionRow.count), logicalBytes: nonnegativeInteger(revisionRow.logicalBytes) };
  const audit = { count: nonnegativeInteger(auditRow.count), ciphertextBytes: nonnegativeInteger(auditRow.ciphertextBytes), encryptedPayloadBytes: nonnegativeInteger(auditRow.encryptedPayloadBytes) };
  const limits: StorageCapacityLimit[] = [
    capacity("rekey-records", "鍵変更で一度に扱える使用中レコード", records.liveCount, backend === "d1" ? 1000 : 5000, "records", "案件以外のプロフィール・雛形・設定も件数に含みます。容量条件も別に適用されます。"),
    capacity("rekey-payload", "鍵変更の送信容量の目安", records.liveEncryptedBytes, 4 * 1024 * 1024, "bytes", "暗号文とIVだけの下限値です。実際にはID・JSON・鍵情報も加わるため、この表示より早く送信上限に達します。実行可能性は保証しません。", "lower-bound"),
  ];
  if (backend === "d1") {
    limits.unshift(
      capacity("sync-records", "現在の同期の総レコード上限", records.totalCount, 1000, "records", "削除済みレコードも含む、現在のアプリの安全上限です。D1自体の保存可能件数ではありません。"),
      capacity("sync-payload", "現在の同期の容量判定", nonnegativeInteger(records.totalEncryptedBytes + records.totalCount * SYNC_ROW_OVERHEAD), 16 * 1024 * 1024, "bytes", "暗号文・IVに1レコードあたり1KiBの安全余白を加えた、アプリの判定値です。実際の保存容量ではありません。鍵変更には別の小さい送信上限があります。"),
    );
    limits.push(
      capacity("audit-records", "全監査検証の件数上限", audit.count, 10000, "records", "上限を超える前にページ単位の全件検証への移行が必要です。記録自体の上限ではありません。"),
      capacity("audit-payload", "全監査検証の詳細容量上限", audit.ciphertextBytes, 16 * 1024 * 1024, "bytes", "監査記録の暗号化詳細の容量です。現在のアプリの全件検証の上限で、DB全体の容量上限ではありません。"),
    );
  }
  return {
    backend,
    measuredAtMs: nonnegativeInteger(measuredAtMs),
    records, revisions, audit,
    logicalBytesTotal: nonnegativeInteger(records.totalEncryptedBytes + revisions.logicalBytes + audit.encryptedPayloadBytes),
    limits,
  };
}
