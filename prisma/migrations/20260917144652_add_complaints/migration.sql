-- CreateEnum
CREATE TYPE "ComplaintCategory" AS ENUM ('plumbing', 'electrical', 'security', 'noise', 'other');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('open', 'acknowledged', 'in_progress', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "ComplaintMediaType" AS ENUM ('photo', 'video');

-- CreateTable
CREATE TABLE "complaints" (
    "id" TEXT NOT NULL,
    "tenancy_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "category" "ComplaintCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_media" (
    "id" TEXT NOT NULL,
    "complaint_id" TEXT NOT NULL,
    "storage_url" TEXT NOT NULL,
    "media_type" "ComplaintMediaType" NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_updates" (
    "id" TEXT NOT NULL,
    "complaint_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "note" TEXT,
    "new_status" "ComplaintStatus",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "complaints_landlord_id_status_idx" ON "complaints"("landlord_id", "status");

-- CreateIndex
CREATE INDEX "complaints_unit_id_idx" ON "complaints"("unit_id");

-- AddForeignKey
ALTER TABLE "complaint_media" ADD CONSTRAINT "complaint_media_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_updates" ADD CONSTRAINT "complaint_updates_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
