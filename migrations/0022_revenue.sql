CREATE TABLE `payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`mode` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`voided_at` integer,
	FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "payouts_mode" CHECK("payouts"."mode" in ('sandbox', 'production')),
	CONSTRAINT "payouts_amount" CHECK("payouts"."amount_cents" between 1 and 100000000),
	CONSTRAINT "payouts_note" CHECK(length("payouts"."note") <= 200)
);
--> statement-breakpoint
CREATE INDEX `payouts_creator_idx` ON `payouts` (`creator_id`,`mode`,`created_at`);--> statement-breakpoint
-- Plain column additions (not table rebuilds): every new column has a default, so existing rows stay valid.
ALTER TABLE `payment_settings` ADD `fee_bp` integer DEFAULT 450 NOT NULL CONSTRAINT "payment_settings_fee_bp" CHECK(`fee_bp` between 0 and 2000);--> statement-breakpoint
ALTER TABLE `payment_settings` ADD `fee_fixed_cents` integer DEFAULT 40 NOT NULL CONSTRAINT "payment_settings_fee_fixed" CHECK(`fee_fixed_cents` between 0 and 500);--> statement-breakpoint
ALTER TABLE `subscription_payments` ADD `total_cents` integer DEFAULT 0 NOT NULL CONSTRAINT "subscription_payments_total" CHECK(`total_cents` >= 0);--> statement-breakpoint
ALTER TABLE `subscription_payments` ADD `tax_cents` integer DEFAULT 0 NOT NULL CONSTRAINT "subscription_payments_tax" CHECK(`tax_cents` >= 0);--> statement-breakpoint
ALTER TABLE `subscription_payments` ADD `refunded_tax_cents` integer DEFAULT 0 NOT NULL CONSTRAINT "subscription_payments_refunded_tax" CHECK(`refunded_tax_cents` >= 0);--> statement-breakpoint
ALTER TABLE `subscription_payments` ADD `fee_cents` integer DEFAULT 0 NOT NULL CONSTRAINT "subscription_payments_fee" CHECK(`fee_cents` >= 0);--> statement-breakpoint
-- Payments recorded before these columns existed: assume no tax, and estimate Polar's fee at the default rate (4.50% + 40 cents).
UPDATE `subscription_payments` SET `total_cents` = `net_cents`, `fee_cents` = (`net_cents` * 450 + 5000) / 10000 + 40;
--> statement-breakpoint
-- A member's share is a whole number of cents. A refund could once leave half a cent behind; round any such share down.
UPDATE `subscription_payments` SET `creator_cents` = cast(`creator_cents` as integer) WHERE typeof(`creator_cents`) <> 'integer';
