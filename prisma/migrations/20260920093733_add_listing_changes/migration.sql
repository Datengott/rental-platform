-- CreateEnum
CREATE TYPE "ListingEntityType" AS ENUM ('property', 'unit');

-- CreateTable
CREATE TABLE "listing_changes" (
    "id" TEXT NOT NULL,
    "entity_type" "ListingEntityType" NOT NULL,
    "property_id" TEXT NOT NULL,
    "unit_id" TEXT,
    "entity_label" TEXT,
    "changed_by" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "note" TEXT,
    "occupied_unit_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "property_verified_at_change" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_changes_property_id_created_at_idx" ON "listing_changes"("property_id", "created_at");

-- CreateIndex
CREATE INDEX "listing_changes_unit_id_created_at_idx" ON "listing_changes"("unit_id", "created_at");

-- CreateIndex
CREATE INDEX "listing_changes_changed_by_created_at_idx" ON "listing_changes"("changed_by", "created_at");

-- CreateIndex
CREATE INDEX "listing_changes_created_at_idx" ON "listing_changes"("created_at");
