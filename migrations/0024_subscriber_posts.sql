-- Posts for subscribers only (docs/PRD.md 8.14, step 3). `subscribers_of` is the creator whose paying subscribers may
-- see the post; null means everyone. Replies to such a post carry the same value. Only adds a column that starts empty, so
-- every post that exists stays public and nothing is rebuilt. The cascade is written by hand because drizzle leaves it
-- out of an added column. It only matters if the creator's whole account is removed, which already removes their posts.
-- Deleting a post is always a soft delete (`deleted_at`), for these posts too.
ALTER TABLE `posts` ADD `subscribers_of` text REFERENCES user(id) ON DELETE cascade;
