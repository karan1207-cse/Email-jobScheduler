ALTER TABLE "emails" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb;
