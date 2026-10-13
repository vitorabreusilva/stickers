ALTER TABLE "books" ADD COLUMN "cover" jsonb;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "stickers" ADD COLUMN "source_rect" jsonb;