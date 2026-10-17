-- SMTP delivery details so the dashboard can link each sent email to its Ethereal preview.
ALTER TABLE "emails" ADD COLUMN "message_id" VARCHAR(255);
ALTER TABLE "emails" ADD COLUMN "preview_url" TEXT;
