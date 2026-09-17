-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('campay', 'monetbil');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'confirmed', 'failed', 'reconciling');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('debit', 'credit');

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenancy_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "amount" DECIMAL(12,0) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_txn_ref" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "receipt_url" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "tenancy_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "entry_type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(12,0) NOT NULL,
    "running_balance" DECIMAL(12,0) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhooks_raw" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature_verified" BOOLEAN NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "payment_webhooks_raw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_tenancy_id_status_idx" ON "payments"("tenancy_id", "status");

-- CreateIndex
CREATE INDEX "payments_status_initiated_at_idx" ON "payments"("status", "initiated_at");

-- CreateIndex
CREATE INDEX "ledger_entries_tenancy_id_created_at_idx" ON "ledger_entries"("tenancy_id", "created_at");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
