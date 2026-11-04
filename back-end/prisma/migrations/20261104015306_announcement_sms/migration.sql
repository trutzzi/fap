-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "sms_failed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sms_recipients" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sms_sent" INTEGER NOT NULL DEFAULT 0;
