CREATE TABLE checkpoint(user_id TEXT NOT NULL,seq INTEGER NOT NULL,hash TEXT NOT NULL,received_at INTEGER NOT NULL,PRIMARY KEY(user_id,seq));
