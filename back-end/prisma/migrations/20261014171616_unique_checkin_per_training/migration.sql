-- One check-in per member per training per day, enforced by the database even if two
-- requests race. Check-ins without a training (open gym) are not constrained here.
CREATE UNIQUE INDEX "check_ins_member_slot_date_key"
  ON "check_ins" ("member_id", "slot_id", "date")
  WHERE "slot_id" IS NOT NULL;

-- Same for refused scans, which the app merges per member/training/day.
CREATE UNIQUE INDEX "refused_scans_member_slot_date_key"
  ON "refused_scans" ("member_id", "slot_id", "date")
  WHERE "slot_id" IS NOT NULL;
