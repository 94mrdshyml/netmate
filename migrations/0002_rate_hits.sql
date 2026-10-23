CREATE TABLE `rate_hits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_hits_key_at_idx` ON `rate_hits` (`key`,`at`);