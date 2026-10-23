CREATE TABLE `likes` (
	`user_id` text NOT NULL,
	`post_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `likes_post_idx` ON `likes` (`post_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`parent_id` text,
	`body` text NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "posts_body_length" CHECK(length("posts"."body") between 1 and 280),
	CONSTRAINT "posts_counts" CHECK("posts"."reply_count" >= 0 and "posts"."like_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `posts_feed_idx` ON `posts` (`created_at`,`id`) WHERE "posts"."parent_id" is null and "posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `posts_replies_idx` ON `posts` (`parent_id`,`created_at`) WHERE "posts"."parent_id" is not null;--> statement-breakpoint
CREATE INDEX `posts_author_idx` ON `posts` (`author_id`,`created_at`);