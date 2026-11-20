// Synthetic identities/data only; never contacts production or external OAuth.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const dep = createRequire(require.resolve("wrangler"));
const web = createRequire(path.resolve("packages/web/package.json"));
const { build } = dep("esbuild");
const { Miniflare, convertV4MiniflareOptions } = dep("miniflare");
const { createClient } = web("@libsql/client");
const { drizzle } = web("drizzle-orm/libsql");

(async () => {
  Object.assign(process.env, {
    NODE_ENV: "production", WEBSITE_URL: "https://cockpit.example.invalid",
    OWNER_EMAILS: "owner@example.invalid",
    BETTER_AUTH_SECRET: "isolated-storage-test-secret-not-for-production-000000000000",
    GOOGLE_CLIENT_ID: "synthetic", GOOGLE_CLIENT_SECRET: "synthetic",
  });
  const bundle = "packages/web/tests/.storage-usage-api-test.mjs";
  await build({
    stdin: { contents: `
      export {createD1Api} from './packages/web/src/api/database/d1/http.ts';
      export {vault} from './packages/web/src/api/routes/vault.ts';
      export {databaseContext} from './packages/web/src/api/database/index.ts';
      export {createApp} from './packages/web/src/api/__core/app.ts';
      export * as schema from './packages/web/src/api/database/schema.ts';`,
      resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "esm", packages: "external", outfile: bundle,
  });
  const { createD1Api, vault, databaseContext, createApp, schema } = await import(require("node:url").pathToFileURL(path.resolve(bundle)));
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: "2026-10-17", d1Databases: ["DB"],
  }));
  const dir = fs.mkdtempSync("/tmp/cockpit-storage-api-");
  const libClient = createClient({ url: `file:${dir}/test.db` });
  try {
    const db = await mf.getD1Database("DB");
    const schemaSql = fs.readFileSync("cloudflare/d1/business-schema.sql", "utf8") + fs.readFileSync("cloudflare/d1/schema.sql", "utf8");
    await db.batch(schemaSql.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
    await libClient.executeMultiple(schemaSql);
    const now = Date.now();
    const session = { id: "owner-session", userId: "owner", token: "owner-token", createdAt: new Date(now), updatedAt: new Date(now), expiresAt: new Date(now + 3600000) };
    const fakeSessionProvider = { api: { getSession: async ({ headers }) => {
      const token = headers.get("cookie");
      if (!token) return null;
      return { session, user: { id: "owner", emailVerified: true, email: token === "non-owner" ? "outsider@example.invalid" : "owner@example.invalid" } };
    } } };
    const libApp = createApp({ vault });
    const fixtures = [
      { backend: "d1", run: (sql, args = []) => db.prepare(sql).bind(...args).run(),
        query: (sql, args = []) => db.prepare(sql).bind(...args).first(),
        request: (...args) => createD1Api(db).request(...args) },
      { backend: "libsql", run: (sql, args = []) => libClient.execute({ sql, args }),
        query: async (sql, args = []) => (await libClient.execute({ sql, args })).rows[0],
        request: async (...args) => {
          // Production creates a libSQL client per request; do not accidentally
          // test overlapping interactive transactions on one local connection.
          const requestClient = createClient({ url: `file:${dir}/test.db` });
          try {
            return await databaseContext.run({ db: drizzle(requestClient, { schema }), auth: fakeSessionProvider }, () => libApp.request(...args));
          } finally { requestClient.close(); }
        } },
    ];
    const cookie = token => "__Secure-better-auth.session_token=" + encodeURIComponent(token + "." + require("node:crypto").createHmac("sha256", process.env.BETTER_AUTH_SECRET).update(token).digest("base64"));
    for (const fixture of fixtures) {
      const { run, query, request, backend } = fixture;
      for (const [id, email] of [["owner", "owner@example.invalid"], ["other", "outsider@example.invalid"]]) {
        await run("INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)", [id, "synthetic", email, now, now]);
        await run("INSERT INTO session(id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)", [id + "-session", now + 3600000, id + "-token", now, now, id]);
        await run("INSERT INTO device(id,user_id,label,platform,created_at_ms,last_seen_at_ms) VALUES (?,?,?,?,?,?)", [id + "-device", id, "synthetic", "test", now, now]);
        await run("INSERT INTO device_session(session_id,user_id,device_id,created_at_ms) VALUES (?,?,?,?)", [id + "-session", id, id + "-device", now]);
      }
      for (const [id, uid, deleted, ciphertext] of [["live", "owner", null, "AAAA"], ["deleted", "owner", now, "BBBBBBBB"], ["private-other-id", "other", null, "private-other-content"]])
        await run("INSERT INTO record(id,user_id,type,ciphertext,iv,updated_at_ms,version,seq,deleted_at) VALUES (?,?,'case',?,'iv',?,1,1,?)", [id, uid, ciphertext, now, deleted]);
      await run("INSERT INTO record_revision(id,user_id,record_id,archived_at_ms,snapshot) VALUES ('revision','owner','live',?,?)", [now, "encrypted-history"]);
      await run("INSERT INTO record_revision(id,user_id,record_id,archived_at_ms,snapshot) VALUES ('other-revision','other','private-other-id',?,?)", [now, "private-other-history"]);
      await run("INSERT INTO audit_event(id,user_id,seq,action,at_ms,payload_ciphertext,payload_iv,prev_hash,hash,hash_version) VALUES ('audit','owner',1,'test',?,'AAAA','iv','GENESIS','synthetic',2)", [now]);
      await run("INSERT INTO audit_event(id,user_id,seq,action,at_ms,prev_hash,hash,hash_version) VALUES ('audit-null','owner',2,'test',?,'synthetic','synthetic2',2)", [now]);
      const headers = { origin: process.env.WEBSITE_URL, "content-type": "application/json", cookie: backend === "d1" ? cookie("owner-token") : "owner" };
      const endpoint = "/api/rpc/vault/storageUsage";
      const rpc = (custom = headers, input = null) => request(endpoint, { method: "POST", headers: custom, body: JSON.stringify({ json: input }) });
      assert.equal((await rpc({ ...headers, cookie: "" })).status, 401, backend + " unauthenticated");
      assert.equal((await rpc({ ...headers, cookie: backend === "d1" ? cookie("other-token") : "non-owner" })).status, 403, backend + " owner allowlist");
      assert.equal((await rpc({ ...headers, origin: "https://evil.invalid" })).status, 403, backend + " foreign origin");
      assert.equal((await query("SELECT count(*) n FROM security_counter WHERE key='storage-usage:owner'")).n, 0);
      const first = await rpc(headers, { userId: "other" }); // Caller cannot choose the aggregate tenant.
      assert.equal(first.status, 200);
      const body = await first.text();
      for (const secret of ["private-other", "encrypted-history", "live\"", "AAAA", "BBBBBBBB"]) assert.equal(body.includes(secret), false, backend + " response only contains metadata");
      const usage = JSON.parse(body).json;
      assert.equal(usage.backend, backend);
      assert.equal(usage.records.liveCount, 1);
      assert.equal(usage.records.deletedCount, 1);
      assert.equal(usage.records.totalEncryptedBytes, 16);
      assert.equal(usage.revisions.count, 1);
      assert.equal(usage.revisions.logicalBytes, 17);
      assert.equal(usage.audit.count, 2);
      assert.equal(usage.audit.encryptedPayloadBytes, 6);
      // D1's batch scheduler provides the runtime concurrency test. Local file
      // libSQL connections fail fast on competing SQLite locks, unlike remote
      // libSQL's request scheduling, so exercise that endpoint sequentially.
      const subsequent = backend === "d1"
        ? await Promise.all([rpc(), rpc(), rpc(), rpc(), rpc()])
        : [await rpc(), await rpc(), await rpc(), await rpc(), await rpc()];
      assert.equal(subsequent.filter(response => response.status === 200).length, 2, backend + " cap allows three total: " + subsequent.map(r => r.status).join(","));
      assert.equal(subsequent.filter(response => response.status === 429).length, 3);
      assert.equal((await query("SELECT count FROM security_counter WHERE key='storage-usage:owner'")).count, 4, backend + " refusal persists");
      assert.equal((await rpc()).status, 429, backend + " new request keeps rate limit");
      assert.equal((await query("SELECT count(*) n FROM record")).n, 3);
      assert.equal((await query("SELECT count(*) n FROM record_revision")).n, 2);
      assert.equal((await query("SELECT count(*) n FROM audit_event")).n, 2);
      await run("UPDATE device SET revoked_at_ms=? WHERE id='owner-device'", [now]);
      assert.equal((await rpc()).status, 403, backend + " revoked device");
    }
    console.log("PASS storage usage API: D1/libSQL owner-only metadata, tenant isolation, no business writes, CSRF/auth/revocation guards, durable rate cap; D1 concurrency");
  } finally {
    libClient.close();
    await mf.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(bundle, { force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
