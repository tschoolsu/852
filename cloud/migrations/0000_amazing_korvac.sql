CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_id` text,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`code_verifier` text NOT NULL,
	`nonce` text NOT NULL,
	`next_path` text DEFAULT '/' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_states_expires` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `resource_members` (
	`resource_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`resource_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_resource_members_user` ON `resource_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `resource_versions` (
	`resource_id` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`url` text,
	`storage_key` text,
	`original_name` text,
	`mime_type` text,
	`size_bytes` integer,
	`parent_id` text,
	`event` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`resource_id`, `revision`)
);
--> statement-breakpoint
CREATE INDEX `idx_resource_versions_created` ON `resource_versions` (`resource_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`url` text,
	`storage_key` text,
	`original_name` text,
	`mime_type` text,
	`size_bytes` integer,
	`owner_id` text NOT NULL,
	`parent_id` text,
	`access_level` text DEFAULT 'private' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`trashed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_resources_parent` ON `resources` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_resources_owner` ON `resources` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_resources_trash` ON `resources` (`trashed_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`csrf_token` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `share_links` (
	`resource_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_hash_unique` ON `share_links` (`token_hash`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`google_subject` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_subject_unique` ON `users` (`google_subject`);