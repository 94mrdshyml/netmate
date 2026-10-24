CREATE TABLE `payment_settings` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`mode` text DEFAULT 'sandbox' NOT NULL,
	`creator_percent` integer DEFAULT 50 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "payment_settings_singleton" CHECK("payment_settings"."id" = 'singleton'),
	CONSTRAINT "payment_settings_mode" CHECK("payment_settings"."mode" in ('sandbox', 'production')),
	CONSTRAINT "payment_settings_creator_percent" CHECK("payment_settings"."creator_percent" between 0 and 100)
);
--> statement-breakpoint
-- instance_secrets is rebuilt only to widen its list of allowed names. No table points at it, so no foreign key is at risk.
CREATE TABLE `__new_instance_secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "instance_secrets_name" CHECK("__new_instance_secrets"."name" in ('resend_api_key', 'resend_from', 'klipy_api_key', 'polar_access_token', 'polar_webhook_secret'))
);
--> statement-breakpoint
INSERT INTO `__new_instance_secrets`("name", "value", "updated_at") SELECT "name", "value", "updated_at" FROM `instance_secrets`;--> statement-breakpoint
DROP TABLE `instance_secrets`;--> statement-breakpoint
ALTER TABLE `__new_instance_secrets` RENAME TO `instance_secrets`;--> statement-breakpoint