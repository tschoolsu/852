CREATE TABLE `auth_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`hits` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_rate_expires` ON `auth_rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_tokens_email` ON `auth_tokens` (`email`);--> statement-breakpoint
CREATE INDEX `idx_auth_tokens_expires` ON `auth_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `password_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`verified_at` text NOT NULL,
	`changed_at` text NOT NULL
);
