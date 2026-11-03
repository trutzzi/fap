-- AlterEnum
ALTER TYPE "CheckInMethod" ADD VALUE 'qr';

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "password_hash" TEXT,
ADD COLUMN     "qr_secret" TEXT;

-- CreateTable
CREATE TABLE "member_sessions" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "member_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_sessions_member_id_idx" ON "member_sessions"("member_id");

-- CreateIndex
CREATE INDEX "member_sessions_expires_at_idx" ON "member_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "member_sessions" ADD CONSTRAINT "member_sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
