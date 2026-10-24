CREATE TABLE `polar_products` (
	`mode` text NOT NULL,
	`creator_id` text NOT NULL,
	`price_cents` integer NOT NULL,
	`product_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`mode`, `creator_id`, `price_cents`),
	FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "polar_products_mode" CHECK("polar_products"."mode" in ('sandbox', 'production')),
	CONSTRAINT "polar_products_price" CHECK("polar_products"."price_cents" between 100 and 10000)
);
--> statement-breakpoint
CREATE TABLE `subscription_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`polar_order_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`mode` text NOT NULL,
	`creator_id` text NOT NULL,
	`subscriber_id` text NOT NULL,
	`net_cents` integer NOT NULL,
	`refunded_cents` integer DEFAULT 0 NOT NULL,
	`split_percent` integer NOT NULL,
	`creator_cents` integer NOT NULL,
	`paid_at` integer NOT NULL,
	`polar_modified_at` integer NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscriber_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "subscription_payments_mode" CHECK("subscription_payments"."mode" in ('sandbox', 'production')),
	CONSTRAINT "subscription_payments_amounts" CHECK("subscription_payments"."net_cents" >= 0 and "subscription_payments"."refunded_cents" >= 0),
	CONSTRAINT "subscription_payments_split" CHECK("subscription_payments"."split_percent" between 0 and 100),
	CONSTRAINT "subscription_payments_share" CHECK("subscription_payments"."creator_cents" >= 0 and "subscription_payments"."creator_cents" <= "subscription_payments"."net_cents")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_payments_polar_order_id_unique` ON `subscription_payments` (`polar_order_id`);--> statement-breakpoint
CREATE INDEX `subscription_payments_creator_idx` ON `subscription_payments` (`creator_id`,`mode`,`paid_at`);--> statement-breakpoint
CREATE INDEX `subscription_payments_subscription_idx` ON `subscription_payments` (`subscription_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`polar_id` text NOT NULL,
	`mode` text NOT NULL,
	`subscriber_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`status` text NOT NULL,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`price_cents` integer NOT NULL,
	`current_period_end` integer,
	`polar_modified_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`subscriber_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "subscriptions_mode" CHECK("subscriptions"."mode" in ('sandbox', 'production')),
	CONSTRAINT "subscriptions_status" CHECK("subscriptions"."status" in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
	CONSTRAINT "subscriptions_not_self" CHECK("subscriptions"."subscriber_id" <> "subscriptions"."creator_id"),
	CONSTRAINT "subscriptions_price" CHECK("subscriptions"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_polar_id_unique` ON `subscriptions` (`polar_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_pair_idx` ON `subscriptions` (`subscriber_id`,`creator_id`,`status`);--> statement-breakpoint
CREATE INDEX `subscriptions_creator_idx` ON `subscriptions` (`creator_id`,`status`);--> statement-breakpoint
-- Plain column additions (not a table rebuild): the new columns have defaults, so every existing row stays valid.
ALTER TABLE `payment_settings` ADD `enabled` integer DEFAULT 0 NOT NULL CONSTRAINT "payment_settings_enabled" CHECK(`enabled` in (0, 1));--> statement-breakpoint
ALTER TABLE `profiles` ADD `subscription_price_cents` integer CONSTRAINT "profiles_subscription_price" CHECK(`subscription_price_cents` is null or `subscription_price_cents` between 100 and 10000);