-- Written to run on any database this app has migrated so far. A preview build of an earlier draft
-- of this change added some of these columns to the shared database under a migration that was
-- later dropped, which also hid 0004 from Drizzle (it only runs migrations newer than the last one
-- it ran), so 0004's columns are made sure of here too.
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "cover" jsonb;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "name" text;--> statement-breakpoint
ALTER TABLE "stickers" ADD COLUMN IF NOT EXISTS "kind" text;--> statement-breakpoint
ALTER TABLE "stickers" ADD COLUMN IF NOT EXISTS "original" jsonb;
