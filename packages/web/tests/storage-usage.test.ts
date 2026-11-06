import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { STORAGE_USAGE_SELECTS, storageUsageQueries, summarizeStorageUsage } from "../src/api/security/storage-usage";

const emptyRecords = { totalCount: 0, liveCount: 0, deletedCount: 0, liveEncryptedBytes: 0, deletedEncryptedBytes: 0, largestCiphertextBytes: 0 };
const emptyRevisions = { count: 0, logicalBytes: 0 };
const emptyAudit = { count: 0, ciphertextBytes: 0, encryptedPayloadBytes: 0 };

test("usage SQL returns only tenant-scoped aggregates and counts UTF-8 revision bytes", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE record(user_id TEXT,deleted_at INTEGER,ciphertext TEXT,iv TEXT);
      CREATE TABLE record_revision(user_id TEXT,snapshot TEXT);
      CREATE TABLE audit_event(user_id TEXT,payload_ciphertext TEXT,payload_iv TEXT);`);
    db.query("INSERT INTO record VALUES (?,?,?,?)").run("owner", null, "AAAA", "iv");
    db.query("INSERT INTO record VALUES (?,?,?,?)").run("owner", 1, "BBBBBBBB", "iv");
    db.query("INSERT INTO record VALUES (?,?,?,?)").run("other", null, "private-other", "iv");
    db.query("INSERT INTO record_revision VALUES (?,?)").run("owner", "{\"暗号文\":\"AAAA\"}");
    db.query("INSERT INTO record_revision VALUES (?,?)").run("other", "private-other");
    db.query("INSERT INTO audit_event VALUES (?,?,?)").run("owner", null, null);
    db.query("INSERT INTO audit_event VALUES (?,?,?)").run("owner", "AAAA", "iv");
    const record = db.query(STORAGE_USAGE_SELECTS.records).get("owner") as Record<string, unknown>;
    const revisions = db.query(STORAGE_USAGE_SELECTS.revisions).get("owner") as Record<string, unknown>;
    const audit = db.query(STORAGE_USAGE_SELECTS.audit).get("owner") as Record<string, unknown>;
    const result = summarizeStorageUsage("d1", record, revisions, audit, 1000);
    expect(result.records).toEqual({ totalCount: 2, liveCount: 1, deletedCount: 1, liveEncryptedBytes: 6, deletedEncryptedBytes: 10, totalEncryptedBytes: 16, largestCiphertextBytes: 8 });
    expect(result.revisions.logicalBytes).toBe(new TextEncoder().encode('{"暗号文":"AAAA"}').length);
    expect(result.audit).toEqual({ count: 2, ciphertextBytes: 4, encryptedPayloadBytes: 6 });
    expect(result.limits.find(x => x.key === "sync-payload")?.used).toBe(16 + 2 * 1024);
    expect(result.limits.find(x => x.key === "audit-payload")?.used).toBe(4);
    expect(JSON.stringify(result)).not.toContain("private-other");
    const unknown = db.query(STORAGE_USAGE_SELECTS.records).get("missing") as Record<string, unknown>;
    expect(unknown).toEqual(emptyRecords);
  } finally { db.close(); }
});

test("libSQL query uses bound owner ID rather than string interpolation", () => {
  const id = "owner' OR 1=1 --";
  const queries = storageUsageQueries(id);
  const dialect = new SQLiteSyncDialect();
  for (const [key, query] of Object.entries(queries)) {
    const compiled = dialect.sqlToQuery(query);
    expect(compiled.sql).toBe(STORAGE_USAGE_SELECTS[key as keyof typeof STORAGE_USAGE_SELECTS]);
    expect(compiled.params).toEqual([id]);
  }
});

test("thresholds warn at 70/90 percent and include deleted rows in D1 sync cap", () => {
  const usage = (n: number) => summarizeStorageUsage("d1", { ...emptyRecords, totalCount: n, deletedCount: n }, emptyRevisions, emptyAudit).limits.find(x => x.key === "sync-records")!;
  expect(usage(699).severity).toBe("normal");
  expect(usage(700).severity).toBe("warning");
  expect(usage(900).severity).toBe("critical");
  expect(usage(1000).severity).toBe("critical");
  expect(usage(1001).severity).toBe("exceeded");
});

test("backend limits and rekey payload caveat do not imply provider capacity or a bill", () => {
  const usage = summarizeStorageUsage("libsql", emptyRecords, emptyRevisions, emptyAudit);
  expect(usage.limits.map(x => x.key)).toEqual(["rekey-records", "rekey-payload"]);
  expect(usage.limits[0].limit).toBe(5000);
  expect(usage.limits[1].basis).toBe("lower-bound");
  expect(usage.limits[1].note).toContain("実行可能性は保証しません");
  expect(usage).not.toHaveProperty("cost");
});

test("missing, inconsistent or unsafe aggregates never become reassuring zeroes", () => {
  for (const bad of [undefined, null, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1.5"])
    expect(() => summarizeStorageUsage("d1", { ...emptyRecords, liveEncryptedBytes: bad }, emptyRevisions, emptyAudit)).toThrow("STORAGE_USAGE_INVALID_AGGREGATE");
  expect(() => summarizeStorageUsage("d1", { ...emptyRecords, liveCount: 1 }, emptyRevisions, emptyAudit)).toThrow();
});
