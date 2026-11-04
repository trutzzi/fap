-- AlterTable
ALTER TABLE "club" ADD COLUMN     "expiry_reminder_sms" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "expiry_reminder_for" DATE;
