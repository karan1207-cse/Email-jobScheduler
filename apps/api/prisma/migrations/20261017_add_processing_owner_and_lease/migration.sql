-- AlterTable
ALTER TABLE "emails" ADD COLUMN "processing_owner" VARCHAR(255),
ADD COLUMN "lease_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "emails_status_lease_expires_at_idx" ON "emails"("status", "lease_expires_at");
