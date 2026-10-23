ALTER TABLE `posts` ADD `place` text CONSTRAINT "posts_place_length" CHECK(`place` is null or length(`place`) between 1 and 60);
