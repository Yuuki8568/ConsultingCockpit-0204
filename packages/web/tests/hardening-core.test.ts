import { appendAudit, auditHash } from "../src/api/security/audit";
import { publishWitnesses } from "../src/api/security/witness";
import { requireStepUp } from "../src/api/security/step-up";
import { verifyWrite } from "../src/api/routes/write-keys";
import { operationHash, signingMessage } from "../src/shared/operation-proof";
import { test, expect } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { databaseContext } from "../src/api/database";
import * as schema from "../src/api/database/schema";
import { consumeLimit, archiveRecords } from "../src/api/security/controls";
import { ciphertextInput, ivInput } from "../src/api/security/inputs";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
test("canonical encrypted fields reject malformed, empty and short input", () => {
  for (const input of ["", "x", "AAAA", "!".repeat(24), "AAAAAAAAAAAAAAAAAAAAAB=="])
    expect(ciphertextInput.safeParse(input).success).toBe(false);
  expect(ciphertextInput.safeParse(btoa("a".repeat(16))).success).toBe(true);
  expect(ivInput.safeParse(btoa("a".repeat(12))).success).toBe(true);
  expect(ivInput.safeParse(btoa("a".repeat(16))).success).toBe(false);
});
test("migration, persistent limits and transactional encrypted revisions", async () => {
  const dir = mkdtempSync("/tmp/cockpit-security-test-");
  const client = createClient({ url: `file:${dir}/test.db` });
  const db = drizzle(client, { schema });
  try {
    await client.executeMultiple(
      "CREATE TABLE audit_event(id TEXT PRIMARY KEY,user_id TEXT,seq INTEGER,action TEXT,at_ms INTEGER,device_id TEXT,payload_ciphertext TEXT,payload_iv TEXT,prev_hash TEXT,hash TEXT);",
    );
    await client.executeMultiple(
      readFileSync("../../security-ops/migrations/20261101-hardening.sql", "utf8"),
    );
    await databaseContext.run({ db }, async () => {
      for (let i = 0; i < 20; i++)
        expect(
          await db.transaction((tx) => consumeLimit(tx, "unlock:user", 1, 20, 900000, 1000)),
        ).toBe(true);
      expect(
        await db.transaction((tx) => consumeLimit(tx, "unlock:user", 1, 20, 900000, 1000)),
      ).toBe(false);
      expect(
        await db.transaction((tx) => consumeLimit(tx, "unlock:user", 1, 20, 900000, 1001)),
      ).toBe(false);
      expect(
        await db.transaction((tx) => consumeLimit(tx, "unlock:user", 1, 20, 900000, 900001)),
      ).toBe(true);
      await db.transaction((tx) => appendAudit(tx, "audit-user", "device", "one", "cipher", "iv"));
      await db.transaction((tx) =>
        appendAudit(tx, "audit-user", "device", "two", "cipher2", "iv2"),
      );
      const auditRows = await db
        .select()
        .from(schema.auditEvent)
        .where(eq(schema.auditEvent.userId, "audit-user"));
      expect(await auditHash({ ...auditRows[0], payloadIv: "tampered" })).not.toBe(
        auditRows[0].hash,
      );
      let anchor = { seq: 0, hash: "GENESIS" };
      const witness = {
        fetch: async (request: Request) => {
          if (request.method === "GET") return Response.json(anchor);
          const b = (await request.json()) as any;
          anchor = { seq: b.seq, hash: b.hash };
          return new Response(null, { status: 200 });
        },
      };
      await databaseContext.run({ db, witness }, publishWitnesses);
      expect(anchor.seq).toBe(2);
      await db.delete(schema.auditEvent).where(eq(schema.auditEvent.id, auditRows[1].id));
      await db
        .update(schema.auditHead)
        .set({ seq: 1, hash: auditRows[0].hash })
        .where(eq(schema.auditHead.userId, "audit-user"));
      await expect(databaseContext.run({ db, witness }, publishWitnesses)).rejects.toThrow(
        "Audit tail missing",
      );
      await db.insert(schema.auditEvent).values(auditRows[1]);
      await db
        .update(schema.auditHead)
        .set({ seq: 2, hash: auditRows[1].hash })
        .where(eq(schema.auditHead.userId, "audit-user"));
      const payload = { id: "test-device" };
      const ticket = {
        id: crypto.randomUUID(),
        userId: "user",
        sessionId: "session",
        action: "device:register",
        payloadHash: await operationHash(payload),
        expiresAtMs: Date.now() + 60000,
      };
      await db.insert(schema.stepUpTicket).values(ticket);
      await expect(
        db.transaction((tx) =>
          requireStepUp(tx, "user", "other-session", "device:register", payload, ticket.id),
        ),
      ).rejects.toThrow();
      await expect(
        db.transaction((tx) =>
          requireStepUp(tx, "user", "session", "device:register", { id: "tamper" }, ticket.id),
        ),
      ).rejects.toThrow();
      await db.transaction((tx) =>
        requireStepUp(tx, "user", "session", "device:register", payload, ticket.id),
      );
      await expect(
        db.transaction((tx) =>
          requireStepUp(tx, "user", "session", "device:register", payload, ticket.id),
        ),
      ).rejects.toThrow();
      await db
        .insert(schema.stepUpTicket)
        .values({ ...ticket, id: "expired", expiresAtMs: Date.now() - 1 });
      await expect(
        db.transaction((tx) =>
          requireStepUp(tx, "user", "session", "device:register", payload, "expired"),
        ),
      ).rejects.toThrow();
      const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
        "sign",
        "verify",
      ]);
      await db
        .insert(schema.writeIdentity)
        .values({
          userId: "user",
          publicKey: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey)),
          privateCiphertext: "synthetic",
          privateIv: "synthetic",
          generation: 1,
          version: 1,
        });
      const request = {
        generation: 1,
        deviceId: "test-device",
        since: 0,
        records: [{ id: "record", ciphertext: "synthetic", baseSeq: 1, deleted: false }],
      };
      const challenge = {
        id: crypto.randomUUID(),
        userId: "user",
        sessionId: "session",
        payloadHash: await operationHash(request),
        expiresAtMs: Date.now() + 60000,
      };
      await db
        .insert(schema.securityChallenge)
        .values({ ...challenge, challenge: "", kind: "write", action: "sync:push" });
      const signature = Buffer.from(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          pair.privateKey,
          new TextEncoder().encode(signingMessage(challenge)),
        ),
      ).toString("base64");
      const signed = { ...request, proof: { id: challenge.id, signature } };
      await expect(
        db.transaction((tx) => verifyWrite(tx, "user", "session", request)),
      ).rejects.toThrow();
      await expect(
        db.transaction((tx) => verifyWrite(tx, "user", "session", { ...signed, generation: 2 })),
      ).rejects.toThrow();
      await expect(
        db.transaction((tx) => verifyWrite(tx, "user", "other", signed)),
      ).rejects.toThrow();
      await expect(
        db.transaction((tx) =>
          verifyWrite(tx, "user", "session", {
            ...signed,
            proof: { ...signed.proof, signature: "invalid" },
          }),
        ),
      ).rejects.toThrow();
      await db.transaction((tx) => verifyWrite(tx, "user", "session", signed));
      await expect(
        db.transaction((tx) => verifyWrite(tx, "user", "session", signed)),
      ).rejects.toThrow();
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plain = new TextEncoder().encode("架空顧客・世代復旧試験");
      const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
      const record = {
        id: "fake",
        userId: "user",
        type: "case",
        ciphertext: Buffer.from(cipher).toString("base64"),
        iv: Buffer.from(iv).toString("base64"),
        updatedAtMs: 1,
        version: 1,
        deletedAt: null,
        deviceId: null,
        seq: 1,
      };
      const vault = {
        userId: "user",
        kdfSalt: "synthetic",
        kdfAlgo: "PBKDF2-SHA256",
        kdfIterations: 600000,
        verifierCiphertext: "synthetic",
        verifierIv: "synthetic",
        generation: 1,
        createdAtMs: 1,
        updatedAtMs: 1,
      };
      await db.transaction((tx) => archiveRecords(tx, [record], vault));
      const [revision] = await db.select().from(schema.recordRevision);
      const saved = JSON.parse(revision.snapshot);
      const restored = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: Buffer.from(saved.record.iv, "base64") },
        key,
        Buffer.from(saved.record.ciphertext, "base64"),
      );
      expect(new TextDecoder().decode(restored)).toBe("架空顧客・世代復旧試験");
      expect(saved.vault.generation).toBe(1);
      await expect(
        db.transaction(async (tx) => {
          await archiveRecords(tx, [{ ...record, id: "rollback" }], vault);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(
        await db
          .select()
          .from(schema.recordRevision)
          .where(eq(schema.recordRevision.recordId, "rollback")),
      ).toHaveLength(0);
    });
  } finally {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
