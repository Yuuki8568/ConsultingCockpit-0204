# Precise local media import

Cockpit pairs with the Intel Mac companion over `http://127.0.0.1:8765`. After pairing, dropping media into the existing recordings panel registers it, performs local recognition, and saves the result against that recording. Video produces a 16 kHz mono PCM WAV first. Audio skips this extraction file; speech is not shortened. Only the first audio track is recognized. This is not speaker/BGM separation.

The companion binds loopback only, checks the exact Host and approved Origin, and requires a per-launch random bearer key. The key stays in React memory. CORS preflight does not grant unauthenticated job access. Processing is single-job, accepts at most 4 GiB / 3 hours, uses a pinned medium model checked by SHA-256, and disables network media protocols. Inputs are streamed to disk; completed uploads are removed after the child exits. Extracted WAV, raw text and review files remain under Documents/CockpitTranscripts (plain files protected by owner-only permissions).

The client polls progress, requests cancellation on abort/navigation/lock, validates model, revision and segments, and preserves recognition originals separately from reviewed imports. An existing edited transcript is never overwritten. Recognition failure leaves the registered recording intact. Business fields are not updated automatically. Original media stays local; transcript case data follows the existing encrypted sync path. Browser termination during upload or before receiving a job ID can leave a local job running; Control+C stops the helper and saved partial output remains. There is no resumable recognition.

## User setup

Download `/downloads/Cockpit-Local-Transcriber-Intel-Mac.zip`, extract, run Setup.command once, then Connect-Cockpit.command when using Cockpit. Paste its key into the recordings panel and connect. Allow the browser's local connection permission. Keep the terminal and case page open. Manual Transcribe.command and reviewed JSON import remain available. No models or private media are bundled in this repository.

## Validation (2026-10-23)

- Actual recording component with real VaultStore and real native model: 30-second conversation WAV and approximately 60-second MP4 processed automatically from an HTTPS origin under the production CSP. First run: 19.8 / 26.3 seconds respectively in the Linux test environment.
- Encrypted IndexedDB persistence, lock/reload/unlock, originals retained, unreviewed marker retained, and business fields unchanged.
- Cancellation leaves recording metadata but does not save a completed transcript.
- Native tests cover origin/key/Host rejection, preflight, oversized input, one-job concurrency and correction safeguards.
- TypeScript app/Node typechecks and Cloudflare dry build pass. Unit/security/worker tests: 35 tests, 589 assertions.

Tests use environment-provided media paths. Private source media and transcript text are excluded from Git. The integration fixture mocks only the authenticated Vault hook; it uses the actual recordings UI, crypto/store, bridge and recognition. Browser permission is granted in the test. Intel Mac real-device performance and continuous 1–3 hour meetings remain unverified; these are accepted input limits, not measured guarantees.

Run `scripts/test-auto-transcription.cjs` from packages/web with BRIDGE_PYTHON, BRIDGE_SCRIPT, BRIDGE_MODEL, BRIDGE_OUTPUT, BRIDGE_TEST_KEY_FILE, TEST_AUDIO, TEST_VIDEO and BENCH_CHROMIUM set. Use private temporary locations for outputs and the test key. Native tests: `python -m unittest discover -s tools/local-transcriber -p 'test_*.py'` in the prepared environment.
