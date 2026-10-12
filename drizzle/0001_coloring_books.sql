CREATE TABLE "books" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"rev" bigint DEFAULT nextval('sync_rev') NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"background" text DEFAULT 'cream' NOT NULL,
	"layout" text DEFAULT 'playful' NOT NULL,
	"created_at" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "books_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "book_pages" ADD COLUMN "book_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "books_rev_idx" ON "books" USING btree ("user_id","rev");