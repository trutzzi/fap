-- CreateEnum
CREATE TYPE "SmsKind" AS ENUM ('pin', 'reminder', 'announcement');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notifications_seen_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" TEXT NOT NULL,
    "member_id" TEXT,
    "to" TEXT NOT NULL,
    "kind" "SmsKind" NOT NULL,
    "sent" BOOLEAN NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_notifications" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ,

    CONSTRAINT "member_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "sms_messages_created_at_idx" ON "sms_messages"("created_at");

-- CreateIndex
CREATE INDEX "member_notifications_member_id_created_at_idx" ON "member_notifications"("member_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_member_id_idx" ON "push_subscriptions"("member_id");

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_notifications" ADD CONSTRAINT "member_notifications_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
