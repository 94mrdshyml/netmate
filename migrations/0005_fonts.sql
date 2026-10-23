CREATE TABLE `fonts` (
	`family` text NOT NULL,
	`weight` integer NOT NULL,
	`style` text NOT NULL,
	`subset` text NOT NULL,
	`unicode_range` text NOT NULL,
	`storage_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`family`, `weight`, `style`, `subset`),
	CONSTRAINT "fonts_weight" CHECK("fonts"."weight" between 100 and 900),
	CONSTRAINT "fonts_style" CHECK("fonts"."style" in ('normal', 'italic')),
	CONSTRAINT "fonts_subset" CHECK("fonts"."subset" in ('latin', 'latin-ext'))
);
