-- AlterEnum
ALTER TYPE "CodePurpose" ADD VALUE 'INVITE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "invitedById" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);


-- Existing accounts registered themselves (and accepted the terms at sign-up).
UPDATE "User" SET "termsAcceptedAt" = "createdAt", "claimedAt" = "createdAt" WHERE "termsAcceptedAt" IS NULL;
