CREATE TABLE `report_events` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`actor_id` text,
	`type` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "report_events_type" CHECK("report_events"."type" in ('filed', 'review_started', 'closed', 'reopened'))
);
--> statement-breakpoint
CREATE INDEX `report_events_report_idx` ON `report_events` (`report_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`case_no` integer NOT NULL,
	`post_id` text,
	`post_author_id` text,
	`post_author_username` text NOT NULL,
	`post_body` text NOT NULL,
	`post_photos` integer DEFAULT 0 NOT NULL,
	`post_has_gif` integer DEFAULT false NOT NULL,
	`post_has_link` integer DEFAULT false NOT NULL,
	`post_is_reply` integer DEFAULT false NOT NULL,
	`post_created_at` integer NOT NULL,
	`reporter_id` text,
	`category` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`outcome` text,
	`resolution_note` text DEFAULT '' NOT NULL,
	`handled_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`post_author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`handled_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reports_case_no" CHECK("reports"."case_no" >= 1),
	CONSTRAINT "reports_category" CHECK("reports"."category" in ('spam', 'harassment', 'hate', 'threat', 'sexual', 'self_harm', 'misinformation', 'impersonation', 'private_info', 'illegal', 'other')),
	CONSTRAINT "reports_note_length" CHECK(length("reports"."note") <= 500 and length("reports"."resolution_note") <= 500),
	CONSTRAINT "reports_status" CHECK("reports"."status" in ('open', 'reviewing', 'closed')),
	CONSTRAINT "reports_outcome" CHECK("reports"."outcome" is null or "reports"."outcome" in ('no_action', 'handled', 'removed', 'duplicate')),
	CONSTRAINT "reports_closed_fields" CHECK(("reports"."status" = 'closed') = ("reports"."outcome" is not null and "reports"."closed_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_case_no_idx` ON `reports` (`case_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `reports_one_live_per_reporter` ON `reports` (`reporter_id`,`post_id`) WHERE "reports"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`,`case_no`);--> statement-breakpoint
CREATE INDEX `reports_post_idx` ON `reports` (`post_id`);--> statement-breakpoint
CREATE INDEX `reports_reporter_idx` ON `reports` (`reporter_id`,`case_no`);