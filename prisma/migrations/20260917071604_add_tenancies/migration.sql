-- CreateEnum
CREATE TYPE "TenancyStatus" AS ENUM ('active', 'notice_given', 'terminated', 'expired');

-- CreateEnum
CREATE TYPE "NoticeReason" AS ENUM ('non_payment', 'end_of_term', 'other');

-- CreateTable
CREATE TABLE "tenancies" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "rent_amount" DECIMAL(12,0) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
    "notice_period_days" INTEGER NOT NULL DEFAULT 90,
    "max_advance_months" INTEGER NOT NULL DEFAULT 3,
    "paid_through_date" DATE,
    "reminder_first_days_before" INTEGER NOT NULL DEFAULT 30,
    "reminder_second_days_before" INTEGER NOT NULL DEFAULT 14,
    "status" "TenancyStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "termination_notices" (
    "id" TEXT NOT NULL,
    "tenancy_id" TEXT NOT NULL,
    "issued_by" TEXT NOT NULL,
    "reason" "NoticeReason",
    "reason_detail" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_date" DATE NOT NULL,
    "document_url" TEXT,
    "delivery_channel" TEXT,
    "delivery_confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "termination_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenancies_landlord_id_status_idx" ON "tenancies"("landlord_id", "status");

-- CreateIndex
CREATE INDEX "tenancies_tenant_id_status_idx" ON "tenancies"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tenancies_paid_through_date_idx" ON "tenancies"("paid_through_date");

-- AddForeignKey
ALTER TABLE "termination_notices" ADD CONSTRAINT "termination_notices_tenancy_id_fkey" FOREIGN KEY ("tenancy_id") REFERENCES "tenancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
