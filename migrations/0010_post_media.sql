CREATE TABLE `post_media` (
	`post_id` text NOT NULL,
	`position` integer NOT NULL,
	`key` text NOT NULL,
	PRIMARY KEY(`post_id`, `position`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "post_media_position" CHECK("post_media"."position" between 0 and 3),
	CONSTRAINT "post_media_key" CHECK("post_media"."key" like 'posts/%')
);
