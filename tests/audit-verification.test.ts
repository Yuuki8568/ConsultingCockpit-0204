import { test, expect } from "bun:test";
import { auditHash } from "../packages/web/src/api/security/audit";
import { verifyAuditPage, type AuditReader } from "../packages/web/src/api/security/audit-verification";
import { verifyAllAuditPages } from "../packages/web/src/web/lib/audit-verification";
import type { AuditVerificationResult } from "../packages/web/src/shared/audit-verification";

const secret = "synthetic-audit-page-secret-not-for-production-00000000";
async function fixture(n = 205, bytes = 0) {
  const rows: Awaited<ReturnType<AuditReader["rows"]>> = [];
  let previous = "GENESIS";
  for (let seq = 1; seq <= n; seq++) {
    const row = { id: `row-${seq}`, userId: "owner", seq, action: "synthetic", atMs: seq,
      deviceId: null, payloadCiphertext: bytes ? "A".repeat(bytes) : null, payloadIv: null,
      prevHash: previous, hash: "", hashVersion: 2 };
    row.hash = await auditHash(row); previous = row.hash; rows.push(row);
  }
  const head = { seq: n, hash: previous }, witness = { ...head };
  let largest = 0, reads = 0;
  const reader: AuditReader = {
    head: async () => ({ ...head }),
    latest: async () => rows.length ? { seq: rows.at(-1)!.seq, hash: rows.at(-1)!.hash } : undefined,
    hashAt: async seq => rows.find(r => r.seq === seq)?.hash,
    metadata: async (after, through) => rows.filter(r => r.seq > after && r.seq <= through).slice(0, 100)
      .map(r => ({ seq: r.seq, hash: r.hash, bytes: new TextEncoder().encode(JSON.stringify(r)).length })),
    rows: async (after, through) => {
      reads++;
      const page = rows.filter(r => r.seq > after && r.seq <= through);
      largest = Math.max(largest, new TextEncoder().encode(JSON.stringify(page)).length);
      return page;
    },
  };
  const options = { reader, userId: "owner", sessionId: "session", backend: "libsql" as const,
    secret, now: 1794031200000, witness: async () => ({ ...witness }) };
  return { rows, head, witness, reader, options, stats: () => ({ largest, reads }),
    page: (cursor?: string) => verifyAuditPage({ ...options, cursor }) };
}

test("full verification crosses the old 10,000-row cap without a partial success", async () => {
  const f = await fixture(10025);
  f.witness.seq = 9000; f.witness.hash = f.rows[8999].hash;
  let pages = 0;
  const result = await verifyAllAuditPages(input => f.page(input.cursor), progress => {
    pages++;
    if (!progress.complete) { expect(progress.ok).toBe(false); expect(progress.checked).toBeLessThan(10025); }
  }, new AbortController().signal);
  expect(result.ok).toBe(true); expect(result.checked).toBe(10025); expect(pages).toBe(101);
  expect(result.witnessSeq).toBe(9000); expect(f.stats().largest).toBeLessThan(100000);
});

test("more than 16 MiB is checked in bounded pages and ciphertext never leaves the verifier", async () => {
  const f = await fixture(25, 750 * 1024);
  const results: AuditVerificationResult[] = [];
  const result = await verifyAllAuditPages(input => f.page(input.cursor), p => results.push(p), new AbortController().signal);
  expect(result.ok).toBe(true); expect(results.length).toBe(13);
  expect(f.stats().largest).toBeLessThan(2 * 1024 * 1024);
  expect(JSON.stringify(results)).not.toContain("AAAA");
});

test("cursor forgery, expiry and user/session/backend/key replay never skip history", async () => {
  const f = await fixture(); const first = await f.page(); expect(first.complete).toBe(false);
  const cursor = first.cursor!;
  const payload = cursor.split(".");
  const forged = JSON.parse(Buffer.from(payload[1], "base64url").toString());
  forged.position.seq = 200; payload[1] = Buffer.from(JSON.stringify(forged)).toString("base64url");
  for (const override of [
    { cursor: payload.join(".") }, { cursor: "not-a-cursor" }, { userId: "other" },
    { sessionId: "other-session" }, { backend: "d1" as const },
    { secret: "x".repeat(32) }, { now: f.options.now + 31 * 60_000 },
  ]) {
    const result = await verifyAuditPage({ ...f.options, cursor, ...override });
    expect(result.ok).toBe(false); expect(result.cursor).toBeUndefined();
  }
});

test("content modification, missing events and changed page boundaries fail closed", async () => {
  for (const kind of ["payload", "missing", "previous-page", "metadata-race", "unsupported-version"]) {
    const f = await fixture(); const first = await f.page();
    if (kind === "payload") f.rows[120].payloadCiphertext = "tampered";
    if (kind === "missing") f.rows.splice(120, 1);
    if (kind === "previous-page") f.rows[99].hash = "f".repeat(64);
    if (kind === "unsupported-version") f.rows[120].hashVersion = 99;
    if (kind === "metadata-race") {
      const read = f.reader.rows;
      f.reader.rows = async (after, through) => { f.rows[100].hash = "f".repeat(64); return read(after, through); };
    }
    const result = await f.page(first.cursor);
    expect(result.ok).toBe(false); expect(result.complete).toBe(true); expect(result.cursor).toBeUndefined();
  }
});

test("appends or rollback between and during pages require a fresh verification", async () => {
  for (const kind of ["head", "tail", "during-read"]) {
    const f = await fixture(); const first = await f.page();
    if (kind === "head") f.head.seq++;
    if (kind === "tail") f.rows.pop();
    if (kind === "during-read") {
      const read = f.reader.rows;
      f.reader.rows = async (a, b) => { const rows = await read(a, b); f.head.hash = "f".repeat(64); return rows; };
    }
    expect((await f.page(first.cursor)).ok).toBe(false);
  }
});

test("independent witness mismatch, rollback and unavailability cannot produce success", async () => {
  for (const kind of ["mismatch", "ahead", "empty", "unavailable", "rollback-at-end", "unavailable-at-end"]) {
    const f = await fixture(1);
    if (kind === "mismatch") f.witness.hash = "f".repeat(64);
    if (kind === "ahead") f.witness.seq++;
    if (kind === "empty") { f.witness.seq = 0; f.witness.hash = "GENESIS"; }
    let calls = 0;
    const result = await verifyAuditPage({ ...f.options, witness: async () => {
      calls++;
      if (kind === "unavailable" || (kind === "unavailable-at-end" && calls > 1)) throw Error("private-service-error");
      if (kind === "rollback-at-end" && calls > 1) return { seq: 0, hash: "GENESIS" };
      return f.witness;
    } });
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("private-service-error");
  }
});

test("an oversized first event is rejected before loading payloads", async () => {
  const f = await fixture(1, 3 * 1024 * 1024);
  expect((await f.page()).ok).toBe(false); expect(f.stats().reads).toBe(0);
});

test("cancellation prevents another page request or a late success", async () => {
  const f = await fixture(); const abort = new AbortController(); let calls = 0;
  await expect(verifyAllAuditPages(async input => { calls++; const result = await f.page(input.cursor); abort.abort(); return result; },
    () => { throw Error("late progress must not be displayed"); }, abort.signal)).rejects.toThrow();
  expect(calls).toBe(1);
});

test("client rejects non-progressing pages and partial success claims", async () => {
  const base: AuditVerificationResult = { ok: false, complete: false, checked: 100, total: 200, startedAtMs: 1, startsAtSeq: 1, cursor: "first" };
  for (const invalid of [{ ...base, ok: true }, { ...base, complete: true, ok: true },
    { ...base, checked: 0 }, { ...base, cursor: undefined }]) {
    await expect(verifyAllAuditPages(async () => invalid, () => {}, new AbortController().signal)).rejects.toThrow();
  }
  let calls = 0;
  await expect(verifyAllAuditPages(async () => { calls++; return base; }, () => {}, new AbortController().signal)).rejects.toThrow();
  expect(calls).toBe(2);
});
