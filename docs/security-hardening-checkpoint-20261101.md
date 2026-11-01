# Cockpit security work checkpoint — 2026-11-01 JST

## Status: incomplete; do not deploy
The execution environment disconnected before the source changes could be committed/pushed. This checkpoint is a progress record, NOT a security fix or a release. No production code, live data, authentication settings or live DB schema was changed in this turn.

Confirmed deployed baseline: `99900e501e42951aa7b05e543f56eebe1722559f` on `feat/cloudflare-independent`. Cloudflare build metadata still reported this exact successful commit.

User selected **passkeys** for operation-specific step-up authentication. User already confirmed backup/restore capability; do not repeat real-data restoration tests. Production deployment requires reviewing concrete changes and test results with the user.

## Local work requiring recovery
Worktree: `/workspace/scratch/c2e87052afc8/cockpit-security-hardening`
Local branch: `fix/security-hardening-20261101`
Changes were still uncommitted when the environment became unavailable. Do not assume they are lost, committed or safely backed up. First recover the worktree and inspect its diff. Do not overwrite it from this checkpoint branch.

Implemented locally:
- Canonical AES-GCM ciphertext/12-byte IV validation and 4 MiB HTTP body cap.
- Server-side encrypted record revisions stored atomically before sync updates and rekey. Revision snapshots include original vault KDF/verifier metadata for old-key recovery; no normal sync API can delete revisions.
- Durable user-scoped request/row/byte counters separate from display history; rejected attempts committed before raising errors.
- Device-to-session binding and retained revocation tombstones. Revoked sessions rejected. Fresh session creation time alone is no longer authority for protected operations.
- SimpleWebAuthn passkey enrollment candidates, UV-required registration/authentication, action/payload/session-scoped 60-second single-use tickets.
- Initial passkey approval is OUTSIDE application RPC: trusted operator must verify the newly enrolled fingerprint before adding it to `COCKPIT_APPROVED_PASSKEYS`. Never approve a candidate just because an existing session registered it.
- P-256 signing identity, private JWK encrypted under the vault key. Register/replace requires a passkey ticket. Sync signatures bind challenge, user, session, operation payload and expiry; unsigned writes have no compatibility fallback.
- Signature key envelope rewrapped during vault key changes; optimistic identity version checking.
- Audit v2 hashes cover user/device/IV and server time using canonical serialization. Critical changes and audit entries share transactions. Unknown audit versions rejected.
- Separate audit witness Worker with append-only API and independent D1 checkpoints; 5-minute scheduled publication verifies source chain before checkpointing. Verification fails incomplete when witness is missing.
- Passkey UI on locked and settings screens; signing setup available only after unlocking.
- All-business-data erase requires a passkey ticket and removes business ciphertext/revisions while retaining security counters, audit evidence, device revocations and passkeys. UI wording updated for retained security data.
- Automatic physical tombstone purge and audit truncation remain disabled pending retention review. This limitation must be disclosed; do not claim every originally requested operation is already complete.
- Read-only rollout mode prepared.
- Sync batch reduced to 8 records to leave subrequest budget for new security checks; client batch byte limit prepared.

Last attempted patch (execution failed; do NOT assume applied): explicit `operation: put | delete` discriminator in sync payload and corresponding client/tests.

## Tests actually observed before disconnect
- Isolated integration run using synthetic accounts, software WebAuthn authenticator and local Miniflare D1 completed successfully, covering:
  - unsigned writes, altered payloads and nonce replay rejection;
  - valid UV-required passkey flow, rejection without user verification;
  - pending passkey unusable before out-of-band approval;
  - action/payload-scoped tickets and one-use enforcement;
  - device/session mismatch, tombstone preservation and revoked-session rejection;
  - generation preservation and rollback when revision insertion fails;
  - rate-limit survival after history deletion and concurrent writer attempts;
  - audit IV binding and external detection after both tail and same-DB head were altered;
  - authorized rekey, rekey retry with a fresh ticket, and authorized business-data erase.
- Existing security suite: 15 tests, 140 expectations passed after adapting the 8-record batching fixture.
- Contract and Cloudflare unit suites: 104 tests passed.
- Typechecks passed at intermediate stages. Final typechecks, final build, complete browser suite and final dependency audit after all modifications were NOT confirmed.
- No physical Touch ID/passkey enrollment on the actual site was performed.
- These results are NOT proof the unfinished final source is release-ready.

## Dependency review
Audit found advisories including better-auth, oRPC, Hono, Zod and Vite. Web dependencies were locally updated to:
`better-auth 1.7.14`, `@better-auth/expo 1.7.14`, `@orpc/{server,client,tanstack-query} 1.16.1`, `hono 4.13.11`, `zod 4.6.6`, `vite 7.3.7`.
New WebAuthn packages: server 14.0.3, browser 14.0.0.
Whole-workspace audit also includes desktop/mobile/build dependencies. Do not claim zero vulnerabilities. Re-run and classify actual shipped Worker/frontend dependencies separately from unrelated workspaces. Local audit files: `/tmp/cockpit-audit.json`, `/tmp/cockpit-audit-after.json` (latter completion unknown).

## External change performed
Created empty D1 database `cockpit-audit-witness`, ID `ffcdfb7b-0617-4bc1-8942-153894d80d04`, APAC hint, replicas disabled.
No schema, user records or audit checkpoints were written into it. Witness Worker not deployed.
The local witness wrangler config still contains a zero UUID placeholder and must be replaced with the verified ID before a reviewed deployment.

Existing CRM-migration database remains separate: `consulting-cockpit-db`, ID `be004feb-0f63-4d9d-b0eb-1c275949081c`. PR #13 remains an unfinished D1 migration candidate; never merge it as-is over these security changes.

## Resume checklist
1. Recover local files, inspect full diff, preserve all work in git before further changes.
2. Complete and test migration SQL against baseline schema; update schema for all new tables. Do not apply to production yet.
3. Check WebAuthn enrollment UI, missing-approval messages, key setup, offline queue retention, rekey recovery, source-code compatibility and per-request subrequest budget.
4. Add/confirm negative tests for ticket expiry, cross-session use, invalid origin, unknown credentials, payload fields, deletions and revision recovery using real encrypted synthetic content.
5. Verify audit witness monotonicity, overwrite/delete refusal, outage behavior and scheduled-publication monitoring. Establish legacy audit baseline without rewriting old records.
6. Finish dependency assessment, production frontend/Worker builds and full CI. Existing browser test suite was edited for the new fail-closed API and needs to run.
7. Create a complete review PR with migration, read-only rollout, initial passkey approval, rollback and retained-data semantics. Do not roll back to unsigned-write code without first disabling write traffic.
8. Ask user to approve the specific production rollout only after reviewable source and validation are complete. User permission is NOT the current blocker; the unavailable execution environment is.
9. After security rollout is approved and validated, finish D1 authoritative-backend migration and then align contract templates with actual storage. Do not overwrite signed documents or claim D1 cutover is complete.
