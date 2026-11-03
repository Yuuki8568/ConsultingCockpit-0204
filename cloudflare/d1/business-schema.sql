-- Generated from current Drizzle schema. Apply only to an empty migration target.
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
;
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);;
CREATE TABLE `audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`seq` integer NOT NULL,
	`action` text NOT NULL,
	`at_ms` integer NOT NULL,
	`device_id` text,
	`payload_ciphertext` text,
	`payload_iv` text,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL,
	`hash_version` integer DEFAULT 1 NOT NULL
);
;
CREATE UNIQUE INDEX `audit_user_seq_uidx` ON `audit_event` (`user_id`,`seq`);;
CREATE INDEX `audit_user_at_idx` ON `audit_event` (`user_id`,`at_ms`);;
CREATE TABLE `audit_head` (
	`user_id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`hash` text NOT NULL
);
;
CREATE TABLE `device` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`platform` text NOT NULL,
	`user_agent` text,
	`created_at_ms` integer NOT NULL,
	`last_seen_at_ms` integer NOT NULL,
	`revoked_at_ms` integer
);
;
CREATE INDEX `device_user_idx` ON `device` (`user_id`);;
CREATE TABLE `device_session` (
	`session_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`created_at_ms` integer NOT NULL
);
;
CREATE TABLE `login_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`at_ms` integer NOT NULL,
	`kind` text NOT NULL,
	`platform` text,
	`user_agent` text,
	`device_id` text
);
;
CREATE INDEX `login_user_at_idx` ON `login_event` (`user_id`,`at_ms`);;
CREATE TABLE `passkey_credential` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at_ms` integer NOT NULL
);
;
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
;
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);;
CREATE TABLE `record` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	`device_id` text,
	`seq` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
;
CREATE INDEX `record_user_seq_idx` ON `record` (`user_id`,`seq`);;
CREATE INDEX `record_user_type_idx` ON `record` (`user_id`,`type`);;
CREATE TABLE `record_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`record_id` text NOT NULL,
	`archived_at_ms` integer NOT NULL,
	`snapshot` text NOT NULL
);
;
CREATE INDEX `revision_user_record_idx` ON `record_revision` (`user_id`,`record_id`,`archived_at_ms`);;
CREATE TABLE `security_challenge` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`challenge` text NOT NULL,
	`action` text NOT NULL,
	`payload_hash` text NOT NULL,
	`expires_at_ms` integer NOT NULL
);
;
CREATE TABLE `security_counter` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
;
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
;
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);;
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);;
CREATE TABLE `step_up_ticket` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`action` text NOT NULL,
	`payload_hash` text NOT NULL,
	`expires_at_ms` integer NOT NULL
);
;
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
;
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);;
CREATE TABLE `vault` (
	`user_id` text PRIMARY KEY NOT NULL,
	`kdf_salt` text NOT NULL,
	`kdf_algo` text DEFAULT 'PBKDF2-SHA256' NOT NULL,
	`kdf_iterations` integer DEFAULT 600000 NOT NULL,
	`verifier_ciphertext` text NOT NULL,
	`verifier_iv` text NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
;
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
;
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);;
CREATE TABLE `write_identity` (
	`user_id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_ciphertext` text NOT NULL,
	`private_iv` text NOT NULL,
	`generation` integer NOT NULL,
	`version` integer NOT NULL
);
;
