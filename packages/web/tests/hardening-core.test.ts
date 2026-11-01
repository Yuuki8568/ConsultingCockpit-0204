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
  for (const input of ["", "x", "AAAA", "!".repeat(24), "AAAAAAAAAAAAAAAAAAAAAB=="]) expect(ciphertextInput.safeParse(input).success).toBe(false);
  expect(ciphertextInput.safeParse(btoa("a".repeat(16))).success).toBe(true);
  expect(ivInput.safeParse(btoa("a".repeat(12))).success).toBe(true);
  expect(ivInput.safeParse(btoa("a".repeat(16))).success).toBe(false);
});
test("migration, persistent limits and transactional encrypted revisions", async () => {
  const dir = mkdtempSync("/tmp/cockpit-security-test-");
  const client = createClient({ url: `file:${dir}/test.db` });
  const db = drizzle(client, { schema });
  try {
    await client.executeMultiple(readFileSync("../../security-ops/migrations/20261101-hardening.sql", "utf8"));
    await databaseContext.run({ db }, async () => {
      for (let i = 0; i < 20; i++) expect(await db.transaction(tx => consumeLimit(tx, "unlock:user", 1, 20, 900000, 1000))).toBe(true);
      expect(await db.transaction(tx => consumeLimit(tx, "unlock:user", 1, 20, 900000, 1000))).toBe(false);
      expect(await db.transaction(tx => consumeLimit(tx, "unlock:user", 1, 20, 900000, 1001))).toBe(false);
      expect(await db.transaction(tx => consumeLimit(tx, "unlock:user", 1, 20, 900000, 900001))).toBe(true);
      const key = await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plain = new TextEncoder().encode('架空顧客・世代復旧試験');
      const cipher = await crypto.subtle.encrypt({name:"AES-GCM",iv},key,plain);
      const record = {id:"fake",userId:"user",type:"case",ciphertext:Buffer.from(cipher).toString("base64"),iv:Buffer.from(iv).toString("base64"),updatedAtMs:1,version:1,deletedAt:null,deviceId:null,seq:1};
      const vault = {userId:"user",kdfSalt:"synthetic",kdfAlgo:"PBKDF2-SHA256",kdfIterations:600000,verifierCiphertext:"synthetic",verifierIv:"synthetic",generation:1,createdAtMs:1,updatedAtMs:1};
      await db.transaction(tx => archiveRecords(tx,[record],vault));
      const [revision] = await db.select().from(schema.recordRevision);
      const saved = JSON.parse(revision.snapshot);
      const restored = await crypto.subtle.decrypt({name:"AES-GCM",iv:Buffer.from(saved.record.iv,"base64")},key,Buffer.from(saved.record.ciphertext,"base64"));
      expect(new TextDecoder().decode(restored)).toBe('架空顧客・世代復旧試験');
      expect(saved.vault.generation).toBe(1);
      await expect(db.transaction(async tx => {await archiveRecords(tx,[{...record,id:"rollback"}],vault);throw new Error("rollback");})).rejects.toThrow("rollback");
      expect(await db.select().from(schema.recordRevision).where(eq(schema.recordRevision.recordId,"rollback"))).toHaveLength(0);
    });
  } finally { client.close(); rmSync(dir, {recursive:true,force:true}); }
});
