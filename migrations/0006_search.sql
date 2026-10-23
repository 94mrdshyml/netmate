-- Full-text search (docs/PRD.md section 8.6). Custom migration: drizzle-kit cannot describe FTS5
-- virtual tables, so they are not in src/db/app-schema.ts.
--
-- Both indexes are derived data. They can be thrown away and rebuilt from `posts` and `profiles`
-- at any time (D1 export does not carry virtual tables). To rebuild, empty both tables
-- (a delete with no where clause on each) and run the two backfill inserts at the bottom.
--
-- `unicode61 remove_diacritics 2` makes matching ignore case and accents. The id columns are
-- UNINDEXED: they are stored, not searchable, and link a row back to its source.
CREATE VIRTUAL TABLE `posts_fts` USING fts5(
	`body`,
	`post_id` UNINDEXED,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `profiles_fts` USING fts5(
	`username`,
	`first_name`,
	`last_name`,
	`user_id` UNINDEXED,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
-- A new post is indexed (replies too). A deleted post, or a row removed with its author, leaves the index.
CREATE TRIGGER `posts_fts_insert` AFTER INSERT ON `posts` WHEN new.`deleted_at` IS NULL BEGIN
	INSERT INTO `posts_fts` (`body`, `post_id`) VALUES (new.`body`, new.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `posts_fts_delete` AFTER UPDATE OF `deleted_at` ON `posts` WHEN old.`deleted_at` IS NULL AND new.`deleted_at` IS NOT NULL BEGIN
	DELETE FROM `posts_fts` WHERE `post_id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `posts_fts_remove` AFTER DELETE ON `posts` BEGIN
	DELETE FROM `posts_fts` WHERE `post_id` = old.`id`;
END;
--> statement-breakpoint
-- Everyone with a profile is indexed; the search query only returns active members.
CREATE TRIGGER `profiles_fts_insert` AFTER INSERT ON `profiles` BEGIN
	INSERT INTO `profiles_fts` (`username`, `first_name`, `last_name`, `user_id`) VALUES (new.`username`, new.`first_name`, new.`last_name`, new.`user_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `profiles_fts_update` AFTER UPDATE OF `username`, `first_name`, `last_name` ON `profiles` BEGIN
	DELETE FROM `profiles_fts` WHERE `user_id` = old.`user_id`;
	INSERT INTO `profiles_fts` (`username`, `first_name`, `last_name`, `user_id`) VALUES (new.`username`, new.`first_name`, new.`last_name`, new.`user_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `profiles_fts_remove` AFTER DELETE ON `profiles` BEGIN
	DELETE FROM `profiles_fts` WHERE `user_id` = old.`user_id`;
END;
--> statement-breakpoint
-- Backfill for an instance that already has data.
INSERT INTO `posts_fts` (`body`, `post_id`) SELECT `body`, `id` FROM `posts` WHERE `deleted_at` IS NULL;
--> statement-breakpoint
INSERT INTO `profiles_fts` (`username`, `first_name`, `last_name`, `user_id`) SELECT `username`, `first_name`, `last_name`, `user_id` FROM `profiles`;
