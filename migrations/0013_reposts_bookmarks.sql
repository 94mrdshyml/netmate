CREATE TABLE `bookmarks` (
	`user_id` text NOT NULL,
	`post_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bookmarks_user_idx` ON `bookmarks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reposts` (
	`user_id` text NOT NULL,
	`post_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reposts_post_idx` ON `reposts` (`post_id`);--> statement-breakpoint
CREATE INDEX `reposts_user_idx` ON `reposts` (`user_id`,`created_at`);--> statement-breakpoint
-- Added by hand: drizzle drops the ON DELETE rule and cannot add a CHECK to an existing table without
-- rebuilding it (a rebuild risks cascade deletes on D1), as with `place` in 0011. A post is a reply or a
-- quote, never both.
ALTER TABLE `posts` ADD `quoted_post_id` text REFERENCES posts(id) ON DELETE set null CONSTRAINT "posts_reply_or_quote" CHECK(`quoted_post_id` is null or `parent_id` is null);--> statement-breakpoint
ALTER TABLE `posts` ADD `repost_count` integer DEFAULT 0 NOT NULL CONSTRAINT "posts_repost_count" CHECK(`repost_count` >= 0);