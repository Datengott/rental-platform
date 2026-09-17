-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('draft', 'pending_signatures', 'fully_signed', 'voided');

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "tenancy_id" TEXT NOT NULL,
    "template_version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "document_url" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contracts_tenancy_id_idx" ON "contracts"("tenancy_id");
