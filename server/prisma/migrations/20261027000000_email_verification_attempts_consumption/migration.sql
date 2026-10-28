ALTER TABLE "email_verification_codes"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "consumed_at" TIMESTAMP(3);
