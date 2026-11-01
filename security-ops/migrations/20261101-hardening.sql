-- Apply once in maintenance/read-only mode, before deploying dependent code.
BEGIN IMMEDIATE;
CREATE TABLE security_counter (key TEXT PRIMARY KEY NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE record_revision (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, record_id TEXT NOT NULL, archived_at_ms INTEGER NOT NULL, snapshot TEXT NOT NULL);
CREATE INDEX revision_user_record_idx ON record_revision(user_id, record_id, archived_at_ms);
CREATE TABLE passkey_credential (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL, fingerprint TEXT NOT NULL, created_at_ms INTEGER NOT NULL);
CREATE TABLE security_challenge (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, session_id TEXT NOT NULL, kind TEXT NOT NULL, challenge TEXT NOT NULL, action TEXT NOT NULL, payload_hash TEXT NOT NULL, expires_at_ms INTEGER NOT NULL);
CREATE TABLE step_up_ticket (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, session_id TEXT NOT NULL, action TEXT NOT NULL, payload_hash TEXT NOT NULL, expires_at_ms INTEGER NOT NULL);
CREATE TABLE device_session (session_id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, device_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL);
CREATE TABLE write_identity (user_id TEXT PRIMARY KEY NOT NULL, public_key TEXT NOT NULL, private_ciphertext TEXT NOT NULL, private_iv TEXT NOT NULL, generation INTEGER NOT NULL, version INTEGER NOT NULL);
ALTER TABLE audit_event ADD COLUMN hash_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE audit_head (user_id TEXT PRIMARY KEY NOT NULL, seq INTEGER NOT NULL, hash TEXT NOT NULL);
INSERT INTO audit_head(user_id,seq,hash) SELECT a.user_id,a.seq,a.hash FROM audit_event a WHERE a.seq=(SELECT max(b.seq) FROM audit_event b WHERE b.user_id=a.user_id);
COMMIT;
