CREATE TABLE `post_links` (
	`post_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`image` text,
	`site` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "post_links_url" CHECK(("post_links"."url" like 'http://%' or "post_links"."url" like 'https://%') and length("post_links"."url") <= 500),
	CONSTRAINT "post_links_title" CHECK(length("post_links"."title") between 1 and 150),
	CONSTRAINT "post_links_description" CHECK(length("post_links"."description") <= 300),
	CONSTRAINT "post_links_image" CHECK("post_links"."image" is null or ("post_links"."image" like 'https://%' and length("post_links"."image") <= 500)),
	CONSTRAINT "post_links_site" CHECK(length("post_links"."site") between 1 and 60)
);
