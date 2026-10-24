ALTER TABLE `profiles` ADD `is_moderator` integer DEFAULT 0 NOT NULL CONSTRAINT "profiles_is_moderator" CHECK(`is_moderator` in (0, 1));
