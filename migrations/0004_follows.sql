CREATE TABLE `follows` (
	`follower_id` text NOT NULL,
	`followee_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`follower_id`, `followee_id`),
	FOREIGN KEY (`follower_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`followee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "follows_not_self" CHECK("follows"."follower_id" <> "follows"."followee_id")
);
--> statement-breakpoint
CREATE INDEX `follows_followee_idx` ON `follows` (`followee_id`,`created_at`,`follower_id`);--> statement-breakpoint
CREATE INDEX `follows_follower_idx` ON `follows` (`follower_id`,`created_at`,`followee_id`);