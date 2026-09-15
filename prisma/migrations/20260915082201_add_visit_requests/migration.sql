-- CreateEnum
CREATE TYPE "VisitRequestStatus" AS ENUM ('pending', 'accepted', 'declined', 'rescheduled', 'expired', 'completed');

-- CreateTable
CREATE TABLE "visit_requests" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "requested_slots" JSONB,
    "status" "VisitRequestStatus" NOT NULL DEFAULT 'pending',
    "confirmed_slot" TIMESTAMP(3),
    "landlord_note" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_requests_landlord_id_status_idx" ON "visit_requests"("landlord_id", "status");

-- CreateIndex
CREATE INDEX "visit_requests_expires_at_idx" ON "visit_requests"("expires_at");
