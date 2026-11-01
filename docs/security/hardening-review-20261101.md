# Cockpit security hardening — review candidate, not deployed

This branch rebuilds work lost from the previous execution environment. Production baseline is repository commit `99900e501e42951aa7b05e543f56eebe1722559f`. The active Worker version was read as `2dced962-5d1a-4eb2-9f02-46f6a75f9f02` at 100%. This confirms deployment metadata, not byte-for-byte agreement with production source. Production source was not retrieved.

## Changes

- Canonical base64 AES-GCM ciphertext and 12-byte IV validation; explicit put/delete operation; HTTP 4 MiB cap and client batches of at most eight records / approximately 3 MiB.
- Atomic encrypted revisions before accepted overwrites and rekey; original vault KDF metadata accompanies each snapshot. Normal sync cannot delete historical versions. No plaintext or vault password is sent to the server.
- Durable request, byte, row and unlock counters independent of display history. Rejections commit counters before raising errors.
- Passkeys require user verification and exact origin/RP/challenge checking. Registration produces an unapproved candidate. Approval is only through a separately verified fingerprint in `COCKPIT_APPROVED_PASSKEYS`; production has no approval API. A test-only approval handler exists solely in `tests/fixture-server.ts` and is excluded from the production entry point.
- One-use 60-second tickets bind user, session, action and canonical payload. Enrollment candidates cannot approve themselves. Session age alone no longer authorizes sensitive operations.
- Encrypted P-256 signing private key, passkey-gated key registration, signed synchronization tied to a one-use challenge and the complete payload. There is no unsigned-write fallback. Key envelopes are rewrapped during rekey.
- Device/session binding plus retained revocation tombstones. IDs remain client-originated, but changing IDs within a session is rejected; authorizing a new binding requires a passkey. Revocation deletes other sessions, including legacy unbound sessions. Revoking the current bound device deletes its session too.
- Server audit v2 includes user, device, IV and server timestamp. Important mutations and audit inserts share transactions. Independent append-only D1 witness checkpoints every five minutes. Verification reports incomplete if the witness is absent or unreachable.
- Business-data erasure preserves audit/security counters/device revocations/passkeys. Automated tombstone purge and audit truncation are intentionally disabled pending a retention policy.
- Better Auth 1.7.14, oRPC 1.16.1, Hono 4.13.14, Zod 4.6.7 and Vite 7.3.7 in the web workspace. Workspace-wide audit still reports other dependencies: this is not a zero-vulnerability claim.
- Access HttpOnly and TLS 1.2 proposals are recorded in `cloudflare-settings-20261101.json`; neither production setting was changed. Binding-cookie activation needs actual browser compatibility checks.

## Validation and boundaries

Observed locally: core/security/Cloudflare tests, actual HTTP rejection and virtual Chromium WebAuthn enrollment/approval/verification/signed-write flow, rekey and revocation tests, contract suites, local D1 witness tests, frontend build and Worker dry-run. Refer to the final PR for exact last-run counts. The fixture uses synthetic accounts, secrets and business data only. The owner's actual backup/restore was already confirmed and was not repeated; existing automated backup regression tests use synthetic data.

A physical Touch ID/passkey, production deployment, real database migration and real browser Access-cookie behavior remain deployment-time checks. A compromised unlocked browser can still use its signing key. Offline guessing after downloading vault KDF/verifier material is not prevented by server rate limits. Checkpoints cannot detect deletion of an uncheckpointed suffix or coordinated compromise of both stores. Legacy audit chains already truncated before this release need an explicit historical baseline decision; do not rewrite old events or silently call them verified.

## Deployment sequence — requires the owner's review and approval

1. Keep this as a draft until CI and review pass. Do not merge directly: Cloudflare Builds follows the target branch and could deploy before schema prerequisites exist.
2. Confirm the authoritative libSQL target using existing protected deployment configuration, without printing credentials. User-confirmed backups need no repeat restore exercise.
3. Block business writes at the edge/maintenance layer before schema changes. Apply `security-ops/migrations/20261101-hardening.sql` once. The guarded helper reads credentials from existing CI secret JSON; it is never called by startup. Audit-head backfill preserves old hashes.
4. Initialize the separate witness D1 schema and deploy its service-only Worker. No public route, workers.dev or preview URL is enabled. Bind only the audit service; do not expose direct witness D1 access to the application.
5. Deploy the reviewed application with `COCKPIT_READ_ONLY=1` (the branch defaults to this). This allows enrollment/identity setup and reads, but refuses business writes. Old clients must reload; unsigned writes must remain rejected.
6. Owner registers a passkey and confirms the fingerprint through an independent trusted interaction. Operator adds exactly that fingerprint to `COCKPIT_APPROVED_PASSKEYS`. Owner authorizes device binding, unlocks the vault and enables signing. Never approve a fingerprint merely because it exists in the DB.
7. Check scheduled witness publication, legacy audit baseline, passkey operation and normal reads. Then approve the separate write-enable configuration change. Test one authorized operation with explicit owner consent rather than creating artificial customer records in production.
8. Apply reviewed Access Cookie/TLS changes and verify actual new login cookies, TLS handshakes and the owner's browsers. TLS zone setting also affects other proxied subdomains. Leave binding cookie disabled if compatibility fails and document why.

## Rollback

Keep business writes blocked first. Code rollback alone does not undo schema, key envelopes or audit versions. The additive schema can remain in place, but old code must never resume unsigned writes. Prefer a corrected hardening release or read-only service. Do not drop revision/counter/identity/audit tables or delete witness checkpoints as part of rollback. Any data restoration is a distinct reviewed operation; do not run destructive reverse SQL automatically.

## Remaining storage/contract work

This branch does **not** move the authoritative business database to D1. Existing draft PRs #11/#13 are not safe to merge blindly: transaction conversion, auth-data migration, deletion/rekey lifecycle and candidate-copy cleanup remain separate work. D1 can store ciphertext, but authoritative cutover is not completed by creating a D1 database or copying snapshots. Contract templates must describe the actual service/storage after cutover; do not state that business data is already stored only in Cloudflare and do not rewrite signed contracts.
