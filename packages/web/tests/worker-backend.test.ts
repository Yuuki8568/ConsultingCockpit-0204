import { afterEach, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { D1Database } from "@cloudflare/workers-types";
import worker from "../src/worker";
import { assertD1MigrationVerified, selectDatabaseBackend } from "../src/database-backend";
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const k of Object.keys(process.env)) if (!(k in originalEnv)) delete process.env[k];
  Object.assign(process.env, originalEnv);
});
const tables = [
  "user",
  "account",
  "session",
  "verification",
  "rate_limit",
  "vault",
  "record",
  "device",
  "device_session",
  "login_event",
  "audit_event",
  "audit_head",
  "passkey_credential",
  "security_challenge",
  "step_up_ticket",
  "security_counter",
  "write_identity",
  "record_revision",
];
const sha = async (value: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
async function fixture() {
  const manifestTables = tables.map((table) => ({ table, rows: 0, sha256: "a".repeat(64) }));
  const hash = await sha(manifestTables);
  let row: { status: string; manifest: string } | null = {
    status: "verified",
    manifest: JSON.stringify({ tables: manifestTables, sha256: hash, cutover: false }),
  };
  let reads = 0;
  const db = {
    prepare(sql: string) {
      if (!sql.includes("cockpit_cutover_receipt")) {
        expect(sql).toContain('"audit_head"');
        return {
          bind() {
            return {
              async raw() {
                return [];
              },
            };
          },
        };
      }
      expect(sql).toContain("cockpit_cutover_receipt");
      return {
        bind(id: string) {
          expect(id).toBe("cockpit-d1-cutover-v1");
          return {
            async first() {
              reads++;
              return row;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return {
    db,
    hash,
    manifestTables,
    get reads() {
      return reads;
    },
    set row(value: typeof row) {
      row = value;
    },
    get row() {
      return row;
    },
  };
}
test("backend selection defaults to libSQL but rejects invalid or incomplete D1 configuration", async () => {
  expect(selectDatabaseBackend({})).toEqual({ kind: "libsql" });
  expect(selectDatabaseBackend({ COCKPIT_DATABASE_BACKEND: "libsql" })).toEqual({ kind: "libsql" });
  for (const value of ["", "D1", "wrong"])
    expect(() => selectDatabaseBackend({ COCKPIT_DATABASE_BACKEND: value })).toThrow();
  expect(() => selectDatabaseBackend({ COCKPIT_DATABASE_BACKEND: "d1" })).toThrow();
  const f = await fixture();
  expect(() =>
    selectDatabaseBackend({
      COCKPIT_DATABASE_BACKEND: "d1",
      COCKPIT_D1: f.db,
      COCKPIT_D1_MANIFEST_SHA256: "wrong",
    }),
  ).toThrow();
  const b = selectDatabaseBackend({
    COCKPIT_DATABASE_BACKEND: "d1",
    COCKPIT_D1: f.db,
    COCKPIT_D1_MANIFEST_SHA256: f.hash,
  });
  expect(b.kind).toBe("d1");
  expect(f.reads).toBe(0);
});
test("D1 receipt must be verified, complete, internally consistent and pinned; no cached approval", async () => {
  const f = await fixture();
  const backend = { kind: "d1" as const, db: f.db, manifestSha256: f.hash };
  await assertD1MigrationVerified(backend);
  expect(f.reads).toBe(1);
  const valid = f.row!;
  for (const status of ["running", "failed"]) {
    f.row = { ...valid, status };
    await expect(assertD1MigrationVerified(backend)).rejects.toThrow();
  }
  f.row = null;
  await expect(assertD1MigrationVerified(backend)).rejects.toThrow();
  f.row = { status: "verified", manifest: "not json" };
  await expect(assertD1MigrationVerified(backend)).rejects.toThrow();
  f.row = valid;
  await expect(
    assertD1MigrationVerified({ ...backend, manifestSha256: "b".repeat(64) }),
  ).rejects.toThrow();
  const altered = structuredClone(f.manifestTables);
  altered[0].rows = 1;
  f.row = { status: "verified", manifest: JSON.stringify({ tables: altered, sha256: f.hash }) };
  await expect(assertD1MigrationVerified(backend)).rejects.toThrow();
  const incomplete = f.manifestTables.slice(1),
    badHash = await sha(incomplete);
  f.row = { status: "verified", manifest: JSON.stringify({ tables: incomplete, sha256: badHash }) };
  await expect(
    assertD1MigrationVerified({ ...backend, manifestSha256: badHash }),
  ).rejects.toThrow();
});
test("Worker D1 dispatch requires Access before receipt reads; serves D1 API without libSQL credentials and refuses invalid receipt", async () => {
  const f = await fixture();
  const issuer = "https://worker-cutover.cloudflareaccess.com";
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = { ...(await exportJWK(publicKey)), kid: "synthetic", alg: "RS256", use: "sig" };
  globalThis.fetch = async (input) => {
    expect(String(input)).toBe(issuer + "/cdn-cgi/access/certs");
    return Response.json({ keys: [publicJwk] });
  };
  Object.assign(process.env, {
    WEBSITE_URL: "https://cockpit.example.invalid",
    OWNER_EMAILS: "owner@example.invalid",
    BETTER_AUTH_SECRET: "isolated-worker-test-secret-not-production-00000000",
    GOOGLE_CLIENT_ID: "test",
    GOOGLE_CLIENT_SECRET: "test",
    COCKPIT_READ_ONLY: "0",
  });
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_AUTH_TOKEN;
  let assets = 0;
  const env = {
    COCKPIT_DATABASE_BACKEND: "d1",
    COCKPIT_D1: f.db,
    COCKPIT_D1_MANIFEST_SHA256: f.hash,
    ACCESS_ISSUER: issuer,
    ACCESS_AUD: "synthetic",
    AUDIT_WITNESS: {
      async fetch() {
        throw Error("No checkpoint should be sent for an empty audit head set");
      },
    },
    ASSETS: {
      async fetch() {
        assets++;
        return new Response("synthetic asset");
      },
    },
  };
  expect((await worker.fetch(new Request("https://cockpit.example.invalid/"), env)).status).toBe(
    403,
  );
  expect(f.reads).toBe(0);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "synthetic" })
    .setIssuer(issuer)
    .setAudience("synthetic")
    .setExpirationTime("5m")
    .sign(privateKey);
  const headers = { "Cf-Access-Jwt-Assertion": jwt };
  const ok = await worker.fetch(
    new Request("https://cockpit.example.invalid/api/health", { headers }),
    env,
  );
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ status: "ok" });
  expect(f.reads).toBe(1);
  expect(assets).toBe(0);
  const staticResponse = await worker.fetch(
    new Request("https://cockpit.example.invalid/", { headers }),
    env,
  );
  expect(staticResponse.status).toBe(200);
  expect(assets).toBe(1);
  await worker.scheduled({} as ScheduledController, env);
  process.env.COCKPIT_READ_ONLY = "1";
  const denied = await worker.fetch(
    new Request("https://cockpit.example.invalid/api/rpc/sync/push", { method: "POST", headers }),
    env,
  );
  expect(denied.status).toBe(503);
  f.row = { status: "failed", manifest: f.row!.manifest };
  const blocked = await worker.fetch(
    new Request("https://cockpit.example.invalid/api/health", { headers }),
    env,
  );
  expect(blocked.status).toBe(503);
  expect(blocked.headers.get("cache-control")).toBe("no-store");
  expect(assets).toBe(1);
  expect(
    (
      await worker.fetch(new Request("https://cockpit.example.invalid/", { headers }), {
        ...env,
        COCKPIT_D1: undefined,
      })
    ).status,
  ).toBe(503);
  await expect(worker.scheduled({} as ScheduledController, env)).rejects.toThrow(
    "D1 migration is not verified",
  );
});
