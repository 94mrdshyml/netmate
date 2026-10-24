-- Prices now include tax (owner decision, session 54). A Polar product keeps the tax setting it was made with, so
-- the products we made before are forgotten here and made again, tax included, the next time someone subscribes.
-- Subscriptions that already exist belong to Polar and keep running on their old product; nothing else refers to this table.
DELETE FROM `polar_products`;
