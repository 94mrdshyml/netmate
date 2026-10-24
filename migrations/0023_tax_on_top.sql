-- Prices now leave tax out and Polar adds it on top (owner decision, session 56). A Polar product keeps the tax setting
-- it was made with, so the products we made before are forgotten here and made again, tax on top, the next time someone
-- subscribes. Subscriptions that already exist belong to Polar and keep running on their old product; nothing else
-- refers to this table.
DELETE FROM `polar_products`;
