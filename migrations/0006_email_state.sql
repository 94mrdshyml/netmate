CREATE TABLE `email_state` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`last_sent_at` integer,
	`last_error` text,
	`last_error_at` integer,
	CONSTRAINT "email_state_singleton" CHECK("email_state"."id" = 'singleton'),
	CONSTRAINT "email_state_error_length" CHECK("email_state"."last_error" is null or length("email_state"."last_error") <= 300)
);
