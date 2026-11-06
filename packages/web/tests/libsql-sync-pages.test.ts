import { test, expect } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { call } from "@orpc/server";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { databaseContext } from "../src/api/database";
import * as schema from "../src/api/database/schema";
import { sync } from "../src/api/routes/sync";
import { ownerEmails } from "../src/api/owner";
import { operationHash, signingMessage } from "../src/shared/operation-proof";
import { MAX_SYNC_PAGE_BYTES, MAX_SYNC_PAGE_ROWS } from "../src/shared/sync-page";

const iv = Buffer.alloc(12, 2).toString("base64");
const cipher = Buffer.alloc(32, 3).toString("base64");
const requestContext = { context: { headers: new Headers() } };

async function fixture(run: (f: {
  db: ReturnType<typeof drizzle<typeof schema>>;
  queries: string[];
  insert: (rows: { id: string; seq: number; ciphertext?: string; userId?: string }[]) => Promise<void>;
}) => Promise<void>) {
  const dir = mkdtempSync("/tmp/cockpit-libsql-paging-");
  const client = createClient({ url: `file:${dir}/test.db` });
  const queries: string[] = [];
  const db = drizzle(client, { schema, logger: { logQuery: q => queries.push(q) } });
  const session = {
    id: "session", userId: "user", token: "synthetic", createdAt: new Date(),
    updatedAt: new Date(), expiresAt: new Date(Date.now() + 600000),
  };
  try {
    await client.executeMultiple(readFileSync(new URL("../../../cloudflare/d1/business-schema.sql", import.meta.url), "utf8"));
    await db.insert(schema.device).values({ id: "test-device", userId: "user", label: "Test", platform: "test", createdAtMs: 1, lastSeenAtMs: 1 });
    await db.insert(schema.deviceSession).values({ sessionId: session.id, userId: "user", deviceId: "test-device", createdAtMs: 1 });
    await db.insert(schema.vault).values({ userId: "user", kdfSalt: "synthetic", verifierCiphertext: cipher, verifierIv: iv, generation: 1, createdAtMs: 1, updatedAtMs: 1 });
    // Real cookie/passkey verification is covered by the separate blackbox suite.
    const auth = { api: { getSession: async () => ({ session, user: { id: "user", email: ownerEmails()[0], emailVerified: true } }) } };
    const insert = async (rows: { id: string; seq: number; ciphertext?: string; userId?: string }[]) => {
      for (let start = 0; start < rows.length; start += 100) {
        await db.insert(schema.record).values(rows.slice(start, start + 100).map(r => ({
          id: r.id, userId: r.userId ?? "user", type: "case", seq: r.seq,
          ciphertext: r.ciphertext ?? cipher, iv, updatedAtMs: 1, version: 1,
        })));
      }
      queries.length = 0;
    };
    await databaseContext.run({ db, auth }, () => run({ db, queries, insert }));
  } finally {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const pull = (after = 0) => call(sync.pullAll, { deviceId: "test-device", after }, requestContext);
const emptyPush = (since = 0) => call(sync.push, { deviceId: "test-device", generation: 1, since, records: [] }, requestContext);

test("libSQL pages a large backlog without loading all ciphertexts or crossing users", async () => {
  await fixture(async ({ insert, queries }) => {
    await insert([
      ...Array.from({ length: 1200 }, (_, i) => ({ id: `row-${i}`, seq: i + 1 })),
      { id: "other-user-row", userId: "other-user", seq: 100000 },
    ]);
    const first = await emptyPush();
    expect(first.changed).toHaveLength(MAX_SYNC_PAGE_ROWS);
    expect(first.cursor).toBe(MAX_SYNC_PAGE_ROWS);
    expect(first.hasMore).toBe(true);
    const payloadReads = queries.filter(q => q.startsWith('select "id", "user_id", "type", "ciphertext"'));
    expect(payloadReads.length).toBe(1);
    expect(payloadReads[0]).toContain('"record"."id" in (');
    const ids = new Set(first.changed.map(r => r.id));
    let cursor = first.cursor;
    for (;;) {
      const page = await pull(cursor);
      expect(page.records.length).toBeLessThanOrEqual(MAX_SYNC_PAGE_ROWS);
      for (const row of page.records) {
        expect(ids.has(row.id)).toBe(false);
        ids.add(row.id);
      }
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    expect(ids.size).toBe(1200);
    expect(cursor).toBe(1200);
    const empty = await emptyPush(cursor);
    expect(empty.changed).toHaveLength(0);
    expect(empty.cursor).toBe(cursor);
    expect(empty.hasMore).toBe(false);
  });
});

test("legacy equal-sequence rows travel together and an oversized group fails closed", async () => {
  await fixture(async ({ db, insert, queries }) => {
    await insert([
      ...Array.from({ length: 255 }, (_, i) => ({ id: `row-${i}`, seq: i + 1 })),
      { id: "tie-a", seq: 256 }, { id: "tie-b", seq: 256 }, { id: "tie-c", seq: 256 },
      { id: "following", seq: 257 },
    ]);
    const first = await pull();
    expect(first.records).toHaveLength(255);
    expect(first.cursor).toBe(255);
    const second = await emptyPush(first.cursor);
    expect(second.changed.map(r => r.id).sort()).toEqual(["following", "tie-a", "tie-b", "tie-c"]);
    expect(second.cursor).toBe(257);
    expect(second.hasMore).toBe(false);
    await db.delete(schema.record);
    await insert(Array.from({ length: 257 }, (_, i) => ({ id: `oversized-${i}`, seq: 1 })));
    await expect(pull()).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(queries.some(q => q.startsWith('select "id", "user_id", "type", "ciphertext"'))).toBe(false);
    await expect(emptyPush()).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});

test("ciphertext pages are bounded by bytes even below the record-count bound", async () => {
  await fixture(async ({ insert }) => {
    await insert(Array.from({ length: 8 }, (_, i) => ({ id: `large-${i}`, seq: i + 1, ciphertext: "A".repeat(1024 * 1024) })));
    let cursor = 0, count = 0;
    for (;;) {
      const page = await pull(cursor);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(MAX_SYNC_PAGE_BYTES);
      expect(page.records.length).toBeLessThanOrEqual(3);
      count += page.records.length;
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    expect(count).toBe(8);
  });
});

test("conflict records outside the page never advance the cursor; replay and revoked bindings are refused", async () => {
  await fixture(async ({ db, insert }) => {
    await insert(Array.from({ length: 600 }, (_, i) => ({ id: `row-${i}`, seq: i + 1 })));
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    await db.insert(schema.writeIdentity).values({ userId: "user", publicKey: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey)), privateCiphertext: cipher, privateIv: iv, generation: 1, version: 1 });
    const input = {
      deviceId: "test-device", generation: 1, since: 0,
      records: [{ id: "row-599", type: "case" as const, operation: "put" as const, ciphertext: Buffer.alloc(32, 8).toString("base64"), iv, updatedAtMs: 2, deleted: false, baseSeq: 0 }],
    };
    const challenge = { id: crypto.randomUUID(), userId: "user", sessionId: "session", payloadHash: await operationHash(input), expiresAtMs: Date.now() + 60000 };
    await db.insert(schema.securityChallenge).values({ ...challenge, kind: "write", action: "sync:push", challenge: "" });
    const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(signingMessage(challenge)))).toString("base64");
    const signed = { ...input, proof: { id: challenge.id, signature } };
    const response = await call(sync.push, signed, requestContext);
    expect(response.conflicts.map(r => r.id)).toEqual(["row-599"]);
    expect(response.changed).toHaveLength(MAX_SYNC_PAGE_ROWS + 1);
    expect(response.cursor).toBe(MAX_SYNC_PAGE_ROWS);
    expect(response.hasMore).toBe(true);
    expect((await pull(response.cursor)).records[0].seq).toBe(MAX_SYNC_PAGE_ROWS + 1);
    await expect(call(sync.push, signed, requestContext)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await db.update(schema.device).set({ revokedAtMs: Date.now() }).where(eq(schema.device.id, "test-device"));
    await expect(pull()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
