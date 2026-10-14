-- CreateEnum
CREATE TYPE "PlanId" AS ENUM ('sessions12', 'unlimited');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('rfid', 'manual');

-- CreateTable
CREATE TABLE "plans" (
    "id" "PlanId" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "session_limit" INTEGER,
    "price" INTEGER,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "coach" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_slots" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "time" CHAR(5) NOT NULL,
    "duration_min" SMALLINT NOT NULL,
    "capacity" SMALLINT NOT NULL,
    "label" TEXT,

    CONSTRAINT "training_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "rfid" TEXT,
    "joined_at" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_courses" (
    "member_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,

    CONSTRAINT "member_courses_pkey" PRIMARY KEY ("member_id","course_id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "member_id" TEXT NOT NULL,
    "plan_id" "PlanId" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "check_ins" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "slot_id" TEXT,
    "training_label" TEXT,
    "date" DATE NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "CheckInMethod" NOT NULL,

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_slots_weekday_idx" ON "training_slots"("weekday");

-- CreateIndex
CREATE UNIQUE INDEX "members_rfid_key" ON "members"("rfid");

-- CreateIndex
CREATE INDEX "members_last_name_first_name_idx" ON "members"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "member_courses_course_id_idx" ON "member_courses"("course_id");

-- CreateIndex
CREATE INDEX "subscriptions_end_date_idx" ON "subscriptions"("end_date");

-- CreateIndex
CREATE INDEX "check_ins_member_id_date_idx" ON "check_ins"("member_id", "date");

-- CreateIndex
CREATE INDEX "check_ins_date_idx" ON "check_ins"("date");

-- CreateIndex
CREATE INDEX "check_ins_slot_id_date_idx" ON "check_ins"("slot_id", "date");

-- AddForeignKey
ALTER TABLE "training_slots" ADD CONSTRAINT "training_slots_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_courses" ADD CONSTRAINT "member_courses_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_courses" ADD CONSTRAINT "member_courses_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "training_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
