-- notifications is rebuilt only to widen two checks (the list of kinds). Nothing points at it, so no foreign key is at risk.
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`type` text NOT NULL,
	`post_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`recipient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notifications_type" CHECK("__new_notifications"."type" in ('like', 'repost', 'follow', 'follow_request', 'reply', 'quote', 'mention', 'invite_used', 'pending_approval', 'subscribe')),
	CONSTRAINT "notifications_no_self" CHECK("__new_notifications"."recipient_id" <> "__new_notifications"."actor_id"),
	CONSTRAINT "notifications_post_matches_type" CHECK(("__new_notifications"."type" in ('follow', 'follow_request', 'invite_used', 'pending_approval', 'subscribe')) = ("__new_notifications"."post_id" is null))
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "recipient_id", "actor_id", "type", "post_id", "created_at", "read_at") SELECT "id", "recipient_id", "actor_id", "type", "post_id", "created_at", "read_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_once_per_post` ON `notifications` (`recipient_id`,`actor_id`,`type`,`post_id`) WHERE "notifications"."post_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_once_per_person` ON `notifications` (`recipient_id`,`actor_id`,`type`) WHERE "notifications"."post_id" is null;--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipient_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_unread_idx` ON `notifications` (`recipient_id`) WHERE "notifications"."read_at" is null;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `notified_at` integer;--> statement-breakpoint
-- Subscriptions that exist already are treated as told about (their creators are not alerted late).
UPDATE `subscriptions` SET `notified_at` = `created_at`;