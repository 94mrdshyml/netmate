CREATE TABLE `instance` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`name` text NOT NULL,
	`logo_key` text,
	`favicon_key` text,
	`primary_color` text NOT NULL,
	`radius` text NOT NULL,
	`font_family` text NOT NULL,
	`avatar_style` text NOT NULL,
	`theme_default` text DEFAULT 'system' NOT NULL,
	`invite_quota` integer DEFAULT 5 NOT NULL,
	`signup_policy` text DEFAULT 'invite_only' NOT NULL,
	`gifs_enabled` integer DEFAULT false NOT NULL,
	`places_enabled` integer DEFAULT false NOT NULL,
	`link_previews_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "instance_singleton" CHECK("instance"."id" = 'singleton'),
	CONSTRAINT "instance_name_length" CHECK(length("instance"."name") between 1 and 30),
	CONSTRAINT "instance_primary_color_hex" CHECK(length("instance"."primary_color") in (4, 7) and substr("instance"."primary_color", 1, 1) = '#' and substr("instance"."primary_color", 2) not glob '*[^0-9A-Fa-f]*'),
	CONSTRAINT "instance_radius" CHECK("instance"."radius" in ('zero', 'sm', 'md', 'lg')),
	CONSTRAINT "instance_theme_default" CHECK("instance"."theme_default" in ('dark', 'light', 'system')),
	CONSTRAINT "instance_invite_quota" CHECK("instance"."invite_quota" >= 0),
	CONSTRAINT "instance_signup_policy" CHECK("instance"."signup_policy" in ('invite_only'))
);
--> statement-breakpoint
CREATE TABLE `instance_secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "instance_secrets_name" CHECK("instance_secrets"."name" in ('resend_api_key', 'resend_from', 'klipy_api_key'))
);
--> statement-breakpoint
CREATE TABLE `invite_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`code` text NOT NULL,
	`uses_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invite_links_uses_count" CHECK("invite_links"."uses_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_links_code_unique` ON `invite_links` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `invite_links_one_active_per_owner` ON `invite_links` (`owner_user_id`) WHERE "invite_links"."revoked_at" is null;--> statement-breakpoint
CREATE TABLE `invite_uses` (
	`id` text PRIMARY KEY NOT NULL,
	`invite_link_id` text NOT NULL,
	`user_id` text NOT NULL,
	`outcome` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invite_link_id`) REFERENCES `invite_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invite_uses_outcome" CHECK("invite_uses"."outcome" in ('approved', 'pending'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_uses_user_id_unique` ON `invite_uses` (`user_id`);--> statement-breakpoint
CREATE INDEX `invite_uses_link_idx` ON `invite_uses` (`invite_link_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`link` text,
	`location` text,
	`is_private` integer DEFAULT false NOT NULL,
	`avatar_key` text,
	`banner_key` text,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`invited_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "profiles_username_rules" CHECK(length("profiles"."username") between 3 and 15 and "profiles"."username" not glob '*[^a-z0-9_]*'),
	CONSTRAINT "profiles_name_length" CHECK(length("profiles"."first_name") between 1 and 50 and length("profiles"."last_name") between 1 and 50),
	CONSTRAINT "profiles_bio_length" CHECK(length("profiles"."bio") <= 160),
	CONSTRAINT "profiles_role" CHECK("profiles"."role" in ('admin', 'member')),
	CONSTRAINT "profiles_status" CHECK("profiles"."status" in ('active', 'pending'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_username_unique` ON `profiles` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_one_admin` ON `profiles` (`role`) WHERE "profiles"."role" = 'admin';--> statement-breakpoint
CREATE INDEX `profiles_invited_by_idx` ON `profiles` (`invited_by`);--> statement-breakpoint
CREATE INDEX `profiles_status_idx` ON `profiles` (`status`);