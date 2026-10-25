-- What each member has seen, to rank their own For you feed (docs/PRD.md 8.3). A new table only: nothing existing changes.
CREATE TABLE `post_seen` (
	`user_id` text NOT NULL,
	`post_id` text NOT NULL,
	`seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_seen_at_idx` ON `post_seen` (`seen_at`);