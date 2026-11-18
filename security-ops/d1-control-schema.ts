/** Published definitions of the bounded migration control tables. */
export const COPY_CHECKPOINT_SCHEMA = `CREATE TABLE cockpit_copy_checkpoint (
 slot INTEGER PRIMARY KEY CHECK(slot=1), run_id TEXT NOT NULL,
 schema_hash TEXT NOT NULL, scope_hash TEXT NOT NULL, copy_hash TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=0), table_index INTEGER NOT NULL,
 cursor_json TEXT, table_rows INTEGER NOT NULL CHECK(table_rows>=0),
 total_rows INTEGER NOT NULL CHECK(total_rows>=0), total_bytes INTEGER NOT NULL CHECK(total_bytes>=0),
 phase TEXT NOT NULL CHECK(phase IN ('copying','copied'))
)`;

export const COPY_VERIFICATION_SCHEMA = `CREATE TABLE cockpit_copy_verification (
 slot INTEGER PRIMARY KEY CHECK(slot=1), run_id TEXT NOT NULL,
 schema_hash TEXT NOT NULL, scope_hash TEXT NOT NULL, copy_hash TEXT NOT NULL,
 copy_revision INTEGER NOT NULL, expected_rows INTEGER NOT NULL, expected_bytes INTEGER NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=0), table_index INTEGER NOT NULL,
 cursor_json TEXT, table_rows INTEGER NOT NULL, total_rows INTEGER NOT NULL, total_bytes INTEGER NOT NULL,
 stream_hash TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('target','source','witness','matched','failed')),
 audit_json TEXT NOT NULL, witness_index INTEGER NOT NULL,
 failure_code TEXT
)`;
