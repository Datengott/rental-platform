-- AlterTable
ALTER TABLE "units" ADD COLUMN     "flag_reason" TEXT,
ADD COLUMN     "flagged_at" TIMESTAMP(3),
ADD COLUMN     "flagged_by" TEXT;

-- CreateTable
CREATE TABLE "admin_actions_log" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_actions_log_target_type_target_id_created_at_idx" ON "admin_actions_log"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_actions_log_admin_id_created_at_idx" ON "admin_actions_log"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_actions_log_created_at_idx" ON "admin_actions_log"("created_at");

-- CreateIndex
CREATE INDEX "units_flagged_at_idx" ON "units"("flagged_at");
