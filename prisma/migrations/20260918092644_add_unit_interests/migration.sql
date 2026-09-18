-- CreateEnum
CREATE TYPE "UnitInterestStatus" AS ENUM ('pending', 'converted');

-- CreateTable
CREATE TABLE "unit_interests" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "status" "UnitInterestStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_interests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_interests_landlord_id_status_idx" ON "unit_interests"("landlord_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "unit_interests_unit_id_tenant_id_key" ON "unit_interests"("unit_id", "tenant_id");
