CREATE TABLE `notifications` (
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
	CONSTRAINT "notifications_type" CHECK("notifications"."type" in ('like', 'repost', 'follow', 'follow_request', 'reply', 'quote', 'mention', 'invite_used', 'pending_approval')),
	CONSTRAINT "notifications_no_self" CHECK("notifications"."recipient_id" <> "notifications"."actor_id"),
	CONSTRAINT "notifications_post_matches_type" CHECK(("notifications"."type" in ('follow', 'follow_request', 'invite_used', 'pending_approval')) = ("notifications"."post_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_once_per_post` ON `notifications` (`recipient_id`,`actor_id`,`type`,`post_id`) WHERE "notifications"."post_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_once_per_person` ON `notifications` (`recipient_id`,`actor_id`,`type`) WHERE "notifications"."post_id" is null;--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipient_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_unread_idx` ON `notifications` (`recipient_id`) WHERE "notifications"."read_at" is null;