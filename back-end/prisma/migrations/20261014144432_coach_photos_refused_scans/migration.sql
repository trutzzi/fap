-- CreateEnum
CREATE TYPE "RefusalReason" AS ENUM ('limit', 'expired', 'no_subscription');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'coach';

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "coach_user_id" TEXT;

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "photo_consent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "member_photos" (
    "member_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "member_photos_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "refused_scans" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "slot_id" TEXT,
    "training_label" TEXT,
    "date" DATE NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" "RefusalReason" NOT NULL,

    CONSTRAINT "refused_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refused_scans_date_idx" ON "refused_scans"("date");

-- CreateIndex
CREATE INDEX "refused_scans_member_id_date_idx" ON "refused_scans"("member_id", "date");

-- CreateIndex
CREATE INDEX "courses_coach_user_id_idx" ON "courses"("coach_user_id");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_photos" ADD CONSTRAINT "member_photos_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refused_scans" ADD CONSTRAINT "refused_scans_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refused_scans" ADD CONSTRAINT "refused_scans_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "training_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
