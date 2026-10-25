-- Moderation tools (docs/PRD.md 8.8a, owner decision session 64): a member can be suspended (a new status with who, when and a
-- staff note), staff removing a post alerts its author ("post_removed"), and closing a case alerts the person who reported it
-- ("report_closed", linked to the case). SQLite cannot widen a CHECK, so two tables are rebuilt, the way 0020 rebuilt
-- notifications: every row is copied, and nothing refers to either table with a foreign key, so no row anywhere is at risk.
-- Rebuilding profiles drops what hung on the old table, so the three search triggers are made again (the search index itself is
-- not touched), and the two checks added by hand in 0016 and 0019 are written into the new table. Nothing is deleted.
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`type` text NOT NULL,
	`post_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`read_at` integer,
	`report_id` text,
	FOREIGN KEY (`recipient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notifications_type" CHECK("__new_notifications"."type" in ('like', 'repost', 'follow', 'follow_request', 'reply', 'quote', 'mention', 'invite_used', 'pending_approval', 'subscribe', 'post_removed', 'report_closed')),
	CONSTRAINT "notifications_no_self" CHECK("__new_notifications"."recipient_id" <> "__new_notifications"."actor_id"),
	CONSTRAINT "notifications_post_matches_type" CHECK(("__new_notifications"."type" in ('follow', 'follow_request', 'invite_used', 'pending_approval', 'subscribe', 'report_closed')) = ("__new_notifications"."post_id" is null)),
	CONSTRAINT "notifications_report_matches_type" CHECK(("__new_notifications"."type" = 'report_closed') = ("__new_notifications"."report_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "recipient_id", "actor_id", "type", "post_id", "created_at", "read_at") SELECT "id", "recipient_id", "actor_id", "type", "post_id", "created_at", "read_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_once_per_post` ON `notifications` (`recipient_id`,`actor_id`,`type`,`post_id`) WHERE "notifications"."post_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_once_per_person` ON `notifications` (`recipient_id`,`actor_id`,`type`) WHERE "notifications"."post_id" is null and "notifications"."report_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_once_per_report` ON `notifications` (`recipient_id`,`report_id`) WHERE "notifications"."report_id" is not null;--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipient_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_unread_idx` ON `notifications` (`recipient_id`) WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE TABLE `__new_profiles` (
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
	`suspended_at` integer,
	`suspended_by` text,
	`suspension_note` text DEFAULT '' NOT NULL,
	`is_moderator` integer DEFAULT 0 NOT NULL CONSTRAINT "profiles_is_moderator" CHECK(`is_moderator` in (0, 1)),
	`subscription_price_cents` integer CONSTRAINT "profiles_subscription_price" CHECK(`subscription_price_cents` is null or `subscription_price_cents` between 100 and 10000),
	`invited_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suspended_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "profiles_username_rules" CHECK(length("__new_profiles"."username") between 3 and 15 and "__new_profiles"."username" not glob '*[^a-z0-9_]*'),
	CONSTRAINT "profiles_name_length" CHECK(length("__new_profiles"."first_name") between 1 and 50 and length("__new_profiles"."last_name") between 1 and 50),
	CONSTRAINT "profiles_bio_length" CHECK(length("__new_profiles"."bio") <= 160),
	CONSTRAINT "profiles_role" CHECK("__new_profiles"."role" in ('admin', 'member')),
	CONSTRAINT "profiles_status" CHECK("__new_profiles"."status" in ('active', 'pending', 'suspended')),
	CONSTRAINT "profiles_suspended_fields" CHECK(("__new_profiles"."status" = 'suspended') = ("__new_profiles"."suspended_at" is not null) and length("__new_profiles"."suspension_note") <= 500)
);
--> statement-breakpoint
INSERT INTO `__new_profiles`("user_id", "username", "first_name", "last_name", "bio", "link", "location", "is_private", "avatar_key", "banner_key", "role", "status", "is_moderator", "subscription_price_cents", "invited_by", "created_at") SELECT "user_id", "username", "first_name", "last_name", "bio", "link", "location", "is_private", "avatar_key", "banner_key", "role", "status", "is_moderator", "subscription_price_cents", "invited_by", "created_at" FROM `profiles`;--> statement-breakpoint
DROP TABLE `profiles`;--> statement-breakpoint
ALTER TABLE `__new_profiles` RENAME TO `profiles`;--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_username_unique` ON `profiles` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_one_admin` ON `profiles` (`role`) WHERE "profiles"."role" = 'admin';--> statement-breakpoint
CREATE INDEX `profiles_invited_by_idx` ON `profiles` (`invited_by`);--> statement-breakpoint
CREATE INDEX `profiles_status_idx` ON `profiles` (`status`);
--> statement-breakpoint
CREATE TRIGGER `profiles_fts_insert` AFTER INSERT ON `profiles` BEGIN
	INSERT INTO `profiles_fts` (`username`, `first_name`, `last_name`, `user_id`) VALUES (new.`username`, new.`first_name`, new.`last_name`, new.`user_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `profiles_fts_update` AFTER UPDATE OF `username`, `first_name`, `last_name` ON `profiles` BEGIN
	DELETE FROM `profiles_fts` WHERE `user_id` = old.`user_id`;
	INSERT INTO `profiles_fts` (`username`, `first_name`, `last_name`, `user_id`) VALUES (new.`username`, new.`first_name`, new.`last_name`, new.`user_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `profiles_fts_remove` AFTER DELETE ON `profiles` BEGIN
	DELETE FROM `profiles_fts` WHERE `user_id` = old.`user_id`;
END;
