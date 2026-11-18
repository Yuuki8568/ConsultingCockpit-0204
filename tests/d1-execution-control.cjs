// Execution limits on a private Miniflare D1 and a temporary local libSQL file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createClient } = require('@libsql/client');
const wranglerRequire = require('node:module').createRequire(require.resolve('wrangler'));
const { build } = wranglerRequire('esbuild');
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');

const runId = '00000000-0000-4000-8000-000000000018';
const scope = {
  maintenanceConfirmed: true, destinationDetached: true,
  sourceIdentitySha256: 'a'.repeat(64), ownerEmails: ['owner@example.invalid'],
};
const usage = () => ({
  observedAtMs: Date.now(), rowsReadToday: 0, rowsWrittenToday: 0,
  workerRequestsToday: 0, accountStorageBytes: 262144, destinationStorageBytes: 262144,
});
const policy = () => ({ expiresAtMs: Date.now() + 300000, maxAttempts: 100,
  dailyReads: 5000000, dailyWrites: 100000, dailyRequests: 100000 });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Knowing when a step has reached the source makes concurrent attempts deterministic.
function pauseAtSource(source) {
  const entered = deferred(), release = deferred();
  return { entered: entered.promise, release: release.resolve, source: {
    async transaction(mode) {
      assert.equal(mode, 'read');
      entered.resolve();
      await release.promise;
      return source.transaction(mode);
    },
  } };
}

async function awaitEntryOrFailure(entered, running) {
  let timer;
  try {
    await Promise.race([entered, running.then(() => { throw Error('Step skipped source read'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Timed out waiting for source read')), 15000); })]);
  } finally { clearTimeout(timer); }
}

// Count actual execution methods. Prepare/bind are local; batch is one D1
// binding call, but every statement in that batch is counted separately.
function meterTarget(target, counts) {
  return { withSession(option) {
    const session = target.withSession(option), originals = new WeakMap();
    function wrap(stmt) {
      const wrapped = { bind: (...args) => wrap(stmt.bind(...args)) };
      for (const method of ['run', 'first', 'all', 'raw']) wrapped[method] = (...args) => {
        counts.d1Calls++; counts.d1Statements++;
        return stmt[method](...args);
      };
      originals.set(wrapped, stmt);
      return wrapped;
    }
    return { prepare: sql => wrap(session.prepare(sql)), batch: batch => {
      counts.d1Calls++; counts.d1Statements += batch.length;
      return session.batch(batch.map(statement => originals.get(statement)));
    } };
  } };
}

// These are local libSQL API calls. Their HTTP transport cost is unmeasured.
function meterSource(source, counts) {
  return { async transaction(mode) {
    counts.sourceTransactions++;
    const tx = await source.transaction(mode);
    return {
      execute(statement) { counts.sourceQueries++; return tx.execute(statement); },
      commit() { counts.sourceCommits++; return tx.commit(); },
      rollback: () => tx.rollback(), close: () => tx.close(),
    };
  } };
}

module.exports = async function runExecutionControlTests() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-execution-control-'));
  const outputDir = fs.mkdtempSync(path.resolve('packages/web/tests/.execution-control-'));
  const outputFile = path.join(outputDir, 'module.mjs');
  const source = createClient({ url: 'file:' + path.join(temp, 'source.sqlite') });
  const names = ['RUN', 'ATTEMPTS', 'READS', 'WRITES', 'REQUESTS', 'USAGE', 'EXPIRED', 'FENCED', 'LOSS', 'DAY', 'OBSERVED', 'ORCHESTRATE', 'LEGACY'];
  const options = { modules: true, script: 'export default {fetch(){return new Response("synthetic")}}',
    compatibilityDate: '2026-10-17', d1Databases: names, resourcePersistencePath: path.join(temp, 'd1') };
  let mf;
  try {
    await build({ stdin: { contents: `export * from './security-ops/d1-execution-control.ts';
      export { COPY_CHECKPOINT_SCHEMA, initializeBoundedCopy, copyBoundedStep } from './security-ops/d1-copy-checkpoint.ts';
      export { COPY_VERIFICATION_SCHEMA } from './security-ops/d1-copy-verification.ts';
      export { RECEIPT_SCHEMA, runMigrationOnce } from './security-ops/d1-maintenance.ts';
      export { readV2Receipt } from './packages/web/src/d1-receipt-v2.ts';
      export { advanceControlledMigration } from './security-ops/d1-orchestration.ts';
      export { selectDatabaseBackend, assertD1MigrationVerified } from './packages/web/src/database-backend.ts';
      export { auditHash } from './packages/web/src/api/security/audit.ts'`,
      resolveDir: process.cwd(), loader: 'ts' }, platform: 'node', format: 'esm',
      bundle: true, packages: 'external', outfile: outputFile });
    const { EXECUTION_CONTROL_SCHEMA, COPY_CHECKPOINT_SCHEMA, COPY_VERIFICATION_SCHEMA, RECEIPT_SCHEMA,
      readV2Receipt, advanceControlledMigration, selectDatabaseBackend, assertD1MigrationVerified, runMigrationOnce,
      STEP_RESERVE, auditHash, initializeBoundedCopy, copyBoundedStep, initializeExecutionControl, getExecutionControlStatus: status,
      runControlledMigrationStep: run } = await import(pathToFileURL(outputFile));
    mf = new Miniflare(convertV4MiniflareOptions(options));
    const business = fs.readFileSync('cloudflare/d1/business-schema.sql', 'utf8');
    const ddl = (business + fs.readFileSync('cloudflare/d1/schema.sql', 'utf8')).replace(/--[^\n]*/g, '')
      .split(';').map(s => s.trim()).filter(Boolean);
    await source.executeMultiple(business);
    await source.execute("INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('owner','synthetic','owner@example.invalid',1,0,0)");
    let head = 'GENESIS';
    for (const seq of [1, 2]) {
      const event = { hashVersion: 2, userId: 'owner', seq, atMs: seq, action: 'synthetic', deviceId: null,
        payloadCiphertext: null, payloadIv: null, prevHash: head };
      const hash = await auditHash(event);
      await source.execute({ sql: 'INSERT INTO audit_event(id,user_id,seq,action,at_ms,hash_version,prev_hash,hash) VALUES (?,?,?,?,?,2,?,?)',
        args: ['event-' + seq, 'owner', seq, event.action, seq, head, hash] });
      head = hash;
    }
    await source.execute({ sql: 'INSERT INTO audit_head(user_id,seq,hash) VALUES (?,?,?)', args: ['owner', 2, head] });
    const databases = {};
    for (const name of names) {
      const db = databases[name] = await mf.getD1Database(name);
      const controlled = name === 'LEGACY' ? [] : [COPY_CHECKPOINT_SCHEMA, COPY_VERIFICATION_SCHEMA, EXECUTION_CONTROL_SCHEMA];
      await db.batch([...ddl, ...controlled, RECEIPT_SCHEMA]
        .map(sql => db.prepare(sql)));
    }
    const measurements = {};
    async function measured(operation, callback) {
      const current = { d1Calls: 0, d1Statements: 0, sourceTransactions: 0, sourceQueries: 0, sourceCommits: 0, witnessCalls: 0 };
      const result = await callback(current);
      const max = measurements[operation] ??= {};
      for (const [key, count] of Object.entries(current)) max[key] = Math.max(count, max[key] ?? 0);
      assert.ok(current.d1Statements <= 50, `${operation}: ${current.d1Statements} D1 statements`);
      assert.ok(current.d1Calls <= 50, `${operation}: ${current.d1Calls} D1 binding calls`);
      return result;
    }
    const initialize = (target, id, controls) => measured('initialize-control', counts =>
      initializeExecutionControl(meterTarget(target, counts), id, controls, meterSource(source, counts)));
    const step = (target, operation, expectedRevision, extra = {}) => measured(operation, counts => run({
      scope, runId, operation, expectedRevision, usage: usage(), ...extra,
      source: meterSource(extra.source ?? source, counts), target: meterTarget(target, counts),
      witness: extra.witness && { fetch(request) { counts.witnessCalls++; return extra.witness.fetch(request); } },
    }));
    const denied = /^Error: EXECUTION_DENIED$/;
    const scalar = async (db, sql) => (await db.prepare(sql).first()).n;
    const rows = db => scalar(db, 'SELECT count(*) n FROM user');
    const revision = db => scalar(db, 'SELECT revision n FROM cockpit_copy_checkpoint');
    const assertReservation = (snapshot, count) => {
      assert.equal(snapshot.attempts, count);
      assert.equal(snapshot.reservedRequests, count * STEP_RESERVE.requests);
      assert.equal(snapshot.reservedReads, count * STEP_RESERVE.reads);
      assert.equal(snapshot.reservedWrites, count * STEP_RESERVE.writes);
      assert.equal(snapshot.cutoverAllowed, false);
    };

    const db = databases.RUN;
    await initialize(db, runId, policy());
    assertReservation(await status(db, runId), 0);
    await assert.rejects(initializeBoundedCopy(db, runId, scope));
    assert.equal(await scalar(db, 'SELECT count(*) n FROM cockpit_copy_checkpoint'), 0);
    await step(db, 'initialize-copy', 0);
    await assert.rejects(copyBoundedStep(source, db, runId, 0, scope));
    assert.equal(await rows(db), 0);
    const gate = pauseAtSource(source);
    const first = step(db, 'copy', 0, { source: gate.source });
    try {
      await awaitEntryOrFailure(gate.entered, first);
      const held = await status(db, runId);
      assert.equal(held.leased, true);
      assertReservation(held, 2);
      await assert.rejects(step(db, 'copy', 0), denied);
      assert.equal(await rows(db), 0);
      assertReservation(await status(db, runId), 2);
    } finally { gate.release(); }
    const copied = await first;
    assert.equal(copied.revision, 1);
    assert.equal(await rows(db), 1);
    assert.equal((await status(db, runId)).leased, false);
    assertReservation(await status(db, runId), 2);

    // Drive the ordinary controlled entry through both verification passes.
    let checkpoint = copied;
    while (checkpoint.phase !== 'copied' && checkpoint.revision < 25) {
      checkpoint = await step(db, 'copy', checkpoint.revision);
    }
    assert.equal(checkpoint.phase, 'copied');
    const witness = { fetch: async () => Response.json({ seq: 2, hash: head }) };
    let verification = await step(db, 'initialize-verification', 0, { witness });
    // At revision zero there is a completed copy and a real verification record,
    // but neither independent pass is complete. An attempted finalization must
    // still consume one reservation and must leave no receipt.
    await assert.rejects(step(db, 'finalize', 0, { witness }));
    assert.equal(await readV2Receipt(db), null);
    assert.equal((await status(db, runId)).leased, true);
    await db.prepare('UPDATE cockpit_execution_control SET lease_until_ms=unixepoch()*1000-1').run();
    while (verification.phase !== 'matched' && verification.revision < 45) {
      verification = await step(db, 'verify', verification.revision, { witness });
    }
    assert.equal(verification.phase, 'matched');
    assert.equal(verification.auditVerified, true);
    assert.equal(verification.cutoverAllowed, false);
    const admissionsBeforeFinalize = 3 + checkpoint.revision + verification.revision;
    assertReservation(await status(db, runId), admissionsBeforeFinalize);

    // Even matching data and a valid fence cannot issue a receipt when the
    // persisted ledger cannot account for both initializers, both passes and finalize.
    const minimumTotal = checkpoint.revision + verification.revision + 3;
    const setSyntheticAdmissions = count => db.prepare(
      'UPDATE cockpit_execution_control SET attempts=?,reserved_requests=?,reserved_reads=?,reserved_writes=?',
    ).bind(count, count * STEP_RESERVE.requests, count * STEP_RESERVE.reads, count * STEP_RESERVE.writes).run();
    await setSyntheticAdmissions(minimumTotal - 2);
    await assert.rejects(step(db, 'finalize', verification.revision, { witness }), /FINALIZE_COMMIT_UNCONFIRMED/);
    assert.equal(await readV2Receipt(db), null);
    assertReservation(await status(db, runId), minimumTotal - 1);
    await setSyntheticAdmissions(admissionsBeforeFinalize + 1);
    await db.prepare('UPDATE cockpit_execution_control SET lease_until_ms=unixepoch()*1000-1').run();
    // The index name, owning table and object type all match the catalog. Only
    // the indexed column differs from the reviewed definition.
    const { sql: originalIndex } = await db.prepare("SELECT sql FROM sqlite_schema WHERE name='account_userId_idx'").first();
    const changedIndex = 'CREATE INDEX account_userId_idx ON account(provider_id)';
    const replaceIndex = (target, definition) => target.batch([
      target.prepare('DROP INDEX account_userId_idx'), target.prepare(definition),
    ]);
    await replaceIndex(db, changedIndex);
    await assert.rejects(step(db, 'finalize', verification.revision, { witness }));
    assert.equal(await readV2Receipt(db), null);
    await replaceIndex(db, originalIndex);
    await db.prepare('UPDATE cockpit_execution_control SET lease_until_ms=unixepoch()*1000-1').run();
    const finished = await step(db, 'finalize', verification.revision, { witness });
    assert.equal(finished.cutoverAllowed, false);
    assert.match(finished.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(await readV2Receipt(db), { runId, sha256: finished.sha256 });
    const pinned = (digest, target = db) => selectDatabaseBackend({ COCKPIT_DATABASE_BACKEND: 'd1',
      COCKPIT_D1: target, COCKPIT_D1_MANIFEST_SHA256: digest });
    await assertD1MigrationVerified(pinned('v2:' + finished.sha256));
    await assert.rejects(assertD1MigrationVerified(pinned('v2:' + '0'.repeat(64))));
    await assert.rejects(assertD1MigrationVerified(pinned(finished.sha256)));
    assertReservation(await status(db, runId), admissionsBeforeFinalize + 3);
    assert.equal(await scalar(db, 'SELECT count(*) n FROM cockpit_cutover_receipt'), 1);
    await db.prepare('UPDATE cockpit_copy_verification SET revision=revision-1').run();
    await assert.rejects(assertD1MigrationVerified(pinned('v2:' + finished.sha256)));
    await db.prepare('UPDATE cockpit_copy_verification SET revision=revision+1').run();
    const { audit_json: storedAudit } = await db.prepare('SELECT audit_json FROM cockpit_copy_verification').first();
    await db.prepare("UPDATE cockpit_copy_verification SET audit_json='[]'").run();
    await assert.rejects(assertD1MigrationVerified(pinned('v2:' + finished.sha256)));
    await db.prepare('UPDATE cockpit_copy_verification SET audit_json=?').bind(storedAudit).run();
    await assertD1MigrationVerified(pinned('v2:' + finished.sha256));

    // Generate a genuine legacy pin using its original producer on an independent
    // database. It works on that target only while the receipt is unambiguous.
    const legacyId = 'cockpit-d1-cutover-v1';
    const legacyTarget = databases.LEGACY;
    assert.deepEqual(await runMigrationOnce(source, legacyTarget, scope.ownerEmails, witness), { started: true, verified: true });
    const { manifest: legacyManifest } = await legacyTarget.prepare('SELECT manifest FROM cockpit_cutover_receipt').first();
    const legacyPin = JSON.parse(legacyManifest).sha256;
    await assertD1MigrationVerified(pinned(legacyPin, legacyTarget));
    const v2 = await db.prepare('SELECT id,status,at_ms,manifest FROM cockpit_cutover_receipt').first();
    const insertReceipt = 'INSERT INTO cockpit_cutover_receipt(id,status,at_ms,manifest) VALUES (?,?,?,?)';
    await legacyTarget.prepare(insertReceipt).bind(v2.id, v2.status, v2.at_ms, v2.manifest).run();
    await assert.rejects(assertD1MigrationVerified(pinned(legacyPin, legacyTarget)));
    await db.prepare(insertReceipt).bind(legacyId, 'verified', Date.now(), legacyManifest).run();
    await assert.rejects(readV2Receipt(db));
    await assert.rejects(assertD1MigrationVerified(pinned('v2:' + finished.sha256)));
    await assert.rejects(assertD1MigrationVerified(pinned(legacyPin)));
    await db.prepare('DELETE FROM cockpit_cutover_receipt WHERE id<>?').bind(legacyId).run();
    await assert.rejects(readV2Receipt(db));
    await assert.rejects(assertD1MigrationVerified(pinned('v2:' + finished.sha256)));
    await assert.rejects(assertD1MigrationVerified(pinned(legacyPin)));

    // Reconstruct the desired operation from persisted progress on every call.
    // This fixture has 4 rows in 18 tables and one owner verification at the end.
    const orchestrated = databases.ORCHESTRATE;
    await initialize(orchestrated, runId, policy());
    const advance = (extra = {}) => measured('orchestration', counts => advanceControlledMigration({
      source: meterSource(source, counts), target: meterTarget(orchestrated, counts), runId, scope,
      usage: usage(), witness: { fetch(request) { counts.witnessCalls++; return witness.fetch(request); } }, ...extra,
    }));
    const copySteps = 4 + 18, verificationSteps = copySteps * 2 + 1;
    const expectedAttempts = 1 + copySteps + 1 + verificationSteps + 1;
    let completed;
    for (let attempt = 1; attempt <= expectedAttempts; attempt++) {
      completed = await advance();
      assert.equal(completed.cutoverAllowed, false);
      assert.equal(completed.phase, attempt === expectedAttempts ? 'complete' : 'progress');
      assertReservation(await status(orchestrated, runId), attempt);
    }
    assert.equal(await revision(orchestrated), copySteps);
    assert.equal(await scalar(orchestrated, 'SELECT revision n FROM cockpit_copy_verification'), verificationSteps);
    assert.deepEqual(await readV2Receipt(orchestrated), { runId, sha256: completed.sha256 });
    assert.deepEqual(await advance(), completed);
    assertReservation(await status(orchestrated, runId), expectedAttempts);
    await replaceIndex(orchestrated, changedIndex);
    await assert.rejects(advance());
    await replaceIndex(orchestrated, originalIndex);
    assert.deepEqual(await advance(), completed);
    await assert.rejects(advance({ runId: '00000000-0000-4000-8000-000000000019' }));
    await assert.rejects(advance({ scope: { ...scope, sourceIdentitySha256: 'b'.repeat(64) } }));
    assert.equal(await scalar(orchestrated, 'SELECT count(*) n FROM cockpit_cutover_receipt'), 1);
    assertReservation(await status(orchestrated, runId), expectedAttempts);

    for (const [name, limit] of [
      ['ATTEMPTS', { maxAttempts: 1 }], ['READS', { dailyReads: STEP_RESERVE.reads }],
      ['WRITES', { dailyWrites: STEP_RESERVE.writes }], ['REQUESTS', { dailyRequests: STEP_RESERVE.requests }],
    ]) {
      const limited = databases[name];
      await initialize(limited, runId, { ...policy(), ...limit });
      await step(limited, 'initialize-copy', 0);
      await assert.rejects(step(limited, 'copy', 0), denied);
      assert.equal(await rows(limited), 0);
      assert.equal(await revision(limited), 0);
      assertReservation(await status(limited, runId), 1);
      await assert.rejects(initialize(limited, runId, policy()));
      assertReservation(await status(limited, runId), 1);
    }

    const busy = databases.USAGE;
    await initialize(busy, runId, policy());
    for (const changes of [
      { rowsReadToday: 5000000 }, { rowsWrittenToday: 100000 }, { workerRequestsToday: 100000 },
      { accountStorageBytes: 5000000000 }, { accountStorageBytes: 500000000, destinationStorageBytes: 500000000 },
      { observedAtMs: Date.now() - 61000 }, { observedAtMs: Date.now() + 60000 },
      { rowsReadToday: -1 }, { rowsWrittenToday: Number.MAX_SAFE_INTEGER + 1 },
      { workerRequestsToday: 0.5 }, { destinationStorageBytes: NaN },
    ]) {
      await assert.rejects(step(busy, 'initialize-copy', 0, { usage: { ...usage(), ...changes } }));
      assertReservation(await status(busy, runId), 0);
    }
    await assert.rejects(step(busy, 'initialize-copy', 0, { usage: undefined }));
    assert.equal(await scalar(busy, 'SELECT count(*) n FROM cockpit_copy_checkpoint'), 0);

    // An observation at the exact limit can admit one operation. Later,
    // lower counters on the same UTC day must not release that capacity.
    const observed = databases.OBSERVED;
    await initialize(observed, runId, policy());
    await step(observed, 'initialize-copy', 0, {
      usage: { ...usage(), rowsReadToday: 5000000 - STEP_RESERVE.reads },
    });
    await assert.rejects(step(observed, 'copy', 0), denied);
    assertReservation(await status(observed, runId), 1);
    assert.equal(await rows(observed), 0);

    const expired = databases.EXPIRED;
    await initialize(expired, runId, policy());
    // Simulate the persisted clock boundary without a timer or an external clock.
    await expired.prepare("UPDATE cockpit_execution_control SET expires_at_ms=unixepoch()*1000-1").run();
    await assert.rejects(step(expired, 'initialize-copy', 0), denied);
    assert.equal(await scalar(expired, 'SELECT count(*) n FROM cockpit_copy_checkpoint'), 0);
    assertReservation(await status(expired, runId), 0);

    const fenced = databases.FENCED;
    await initialize(fenced, runId, policy());
    await step(fenced, 'initialize-copy', 0);
    const oldGate = pauseAtSource(source);
    const oldStep = step(fenced, 'copy', 0, { source: oldGate.source });
    const oldRejected = assert.rejects(oldStep);
    try {
      await awaitEntryOrFailure(oldGate.entered, oldStep);
      await fenced.prepare('UPDATE cockpit_execution_control SET lease_until_ms=unixepoch()*1000-1').run();
      // A second holder is alive when the stale operation resumes. The stale
      // operation must neither commit nor release its successor's lease.
      const newGate = pauseAtSource(source);
      const newStep = step(fenced, 'copy', 0, { source: newGate.source });
      try {
        await awaitEntryOrFailure(newGate.entered, newStep);
        oldGate.release();
        await oldRejected;
        assert.equal(await revision(fenced), 0);
        assert.equal(await rows(fenced), 0);
        assert.equal((await status(fenced, runId)).leased, true);
      } finally { newGate.release(); }
      await newStep;
    } finally { oldGate.release(); }
    assert.equal(await rows(fenced), 1);
    assert.equal(await revision(fenced), 1);
    assertReservation(await status(fenced, runId), 3);

    const day = databases.DAY;
    await initialize(day, runId, { ...policy(), maxAttempts: 2, dailyRequests: STEP_RESERVE.requests });
    await step(day, 'initialize-copy', 0);
    await assert.rejects(step(day, 'copy', 0), denied);
    // Only a synthetic prior UTC day is injected. Lifetime attempts survive the reset.
    await day.prepare('UPDATE cockpit_execution_control SET utc_day=utc_day-1, observed_at_ms=observed_at_ms-86400000').run();
    await step(day, 'copy', 0);
    const nextDay = await status(day, runId);
    assert.equal(nextDay.attempts, 2);
    assert.equal(nextDay.reservedReads, STEP_RESERVE.reads);
    assert.equal(nextDay.reservedWrites, STEP_RESERVE.writes);
    assert.equal(nextDay.reservedRequests, STEP_RESERVE.requests);
    assert.equal(await rows(day), 1);
    await day.prepare('UPDATE cockpit_execution_control SET utc_day=utc_day-1, observed_at_ms=observed_at_ms-86400000').run();
    await assert.rejects(step(day, 'copy', 1), denied);
    assert.equal(await revision(day), 1);

    const loss = databases.LOSS;
    await initialize(loss, runId, policy());
    await step(loss, 'initialize-copy', 0);
    // Drop the response only after the data-and-checkpoint batch commits.
    const ambiguous = afterDataCommit(loss);
    await assert.rejects(step(ambiguous, 'copy', 0));
    assert.equal(await rows(loss), 1);
    assert.equal(await revision(loss), 1);
    assertReservation(await status(loss, runId), 2);
    assert.equal((await status(loss, runId)).leased, true);
    await assert.rejects(step(loss, 'copy', 0), denied);
    assertReservation(await status(loss, runId), 2);

    await mf.dispose();
    mf = new Miniflare(convertV4MiniflareOptions(options));
    const reopened = await mf.getD1Database('LOSS');
    assert.equal(await revision(reopened), 1);
    assertReservation(await status(reopened, runId), 2);
    await reopened.prepare('UPDATE cockpit_execution_control SET lease_until_ms=unixepoch()*1000-1').run();
    await step(reopened, 'copy', 1);
    assert.equal(await revision(reopened), 2);
    assert.equal(await rows(reopened), 1);
    assertReservation(await status(reopened, runId), 3);
    assert.equal(await scalar(reopened, 'SELECT count(*) n FROM cockpit_atomic_assertion'), 0);
    console.log('Measured local controlled operation maxima', JSON.stringify(measurements));
    console.log('PASS controlled migration: durable attempt and daily limits, bounded account usage, expiry, concurrent exclusion, fenced stale writer, ambiguous commit recovery and UTC rollover');
    console.log('PASS controlled receipt: matched evidence, minimum 70 admissions for fixture, per-call orchestration, durable readback, index drift, runtime pins and legacy compatibility');
  } finally {
    source.close();
    if (mf) await mf.dispose();
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  }
};

// The batch commits on the real local D1. Only its return to the caller is lost.
function afterDataCommit(db) {
  let injected = false;
  return new Proxy(db, { get(target, key) {
    if (key === 'withSession') return option => {
      const session = target.withSession(option);
      return new Proxy(session, { get(s, k) {
        if (k === 'batch') return async batch => {
          const result = await s.batch(batch);
          const saved = await s.prepare('SELECT revision FROM cockpit_copy_checkpoint').first();
          if (!injected && saved?.revision === 1) {
            injected = true;
            throw Error('lost synthetic data commit response');
          }
          return result;
        };
        const value = s[k]; return typeof value === 'function' ? value.bind(s) : value;
      } });
    };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
}

if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
