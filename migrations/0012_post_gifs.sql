CREATE TABLE `post_gifs` (
	`post_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`title` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "post_gifs_url" CHECK("post_gifs"."url" like 'https://static.klipy.com/%' or "post_gifs"."url" like 'https://static1.klipy.com/%' or "post_gifs"."url" like 'https://static2.klipy.com/%'),
	CONSTRAINT "post_gifs_size" CHECK("post_gifs"."width" between 1 and 4096 and "post_gifs"."height" between 1 and 4096),
	CONSTRAINT "post_gifs_title" CHECK("post_gifs"."title" is null or length("post_gifs"."title") <= 140)
);
