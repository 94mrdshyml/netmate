CREATE TABLE `blocks` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`blocker_id`, `blocked_id`),
	FOREIGN KEY (`blocker_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "blocks_not_self" CHECK("blocks"."blocker_id" <> "blocks"."blocked_id")
);
--> statement-breakpoint
CREATE INDEX `blocks_blocked_idx` ON `blocks` (`blocked_id`,`blocker_id`);--> statement-breakpoint
CREATE INDEX `blocks_blocker_idx` ON `blocks` (`blocker_id`,`created_at`,`blocked_id`);--> statement-breakpoint
CREATE TABLE `follow_requests` (
	`requester_id` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`requester_id`, `target_id`),
	FOREIGN KEY (`requester_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "follow_requests_not_self" CHECK("follow_requests"."requester_id" <> "follow_requests"."target_id")
);
--> statement-breakpoint
CREATE INDEX `follow_requests_target_idx` ON `follow_requests` (`target_id`,`created_at`,`requester_id`);--> statement-breakpoint
CREATE TABLE `mutes` (
	`muter_id` text NOT NULL,
	`muted_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`muter_id`, `muted_id`),
	FOREIGN KEY (`muter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`muted_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mutes_not_self" CHECK("mutes"."muter_id" <> "mutes"."muted_id")
);
--> statement-breakpoint
CREATE INDEX `mutes_muter_idx` ON `mutes` (`muter_id`,`created_at`,`muted_id`);