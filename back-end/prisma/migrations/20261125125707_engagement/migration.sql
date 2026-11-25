-- AlterEnum
ALTER TYPE "SmsKind" ADD VALUE 'nudge';

-- AlterTable
ALTER TABLE "club" ADD COLUMN     "google_review_url" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "inactivity_nudge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inactivity_nudge_sms" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "review_after_check_ins" SMALLINT NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "inactivity_nudge_for" DATE,
ADD COLUMN     "review_prompt_done_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "subscription_freezes" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "from" DATE NOT NULL,
    "to" DATE NOT NULL,
    "days" SMALLINT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,

    CONSTRAINT "subscription_freezes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_freezes_member_id_idx" ON "subscription_freezes"("member_id");

-- AddForeignKey
ALTER TABLE "subscription_freezes" ADD CONSTRAINT "subscription_freezes_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_freezes" ADD CONSTRAINT "subscription_freezes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
