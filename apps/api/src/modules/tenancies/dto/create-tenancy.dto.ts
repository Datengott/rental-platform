import { IsIn, IsInt, IsOptional, IsPositive, IsUUID, Matches, Max, Min } from 'class-validator';

export const BILLING_CYCLES = ['monthly', 'quarterly', 'biannual'] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateTenancyDto {
  @IsUUID()
  unit_id!: string;

  @IsUUID()
  tenant_id!: string;

  @Matches(DATE_ONLY, { message: 'start_date must be a date in YYYY-MM-DD format' })
  start_date!: string;

  // XAF has no minor unit (CLAUDE.md) — whole numbers only.
  @IsInt()
  @IsPositive()
  rent_amount!: number;

  // Multi-currency is out of scope for the MVP (CLAUDE.md).
  @IsOptional()
  @IsIn(['XAF'])
  currency?: 'XAF';

  @IsOptional()
  @IsIn(BILLING_CYCLES)
  billing_cycle?: (typeof BILLING_CYCLES)[number];

  // Not client-settable below the statutory floor (default 90) —
  // api-specification.md Section 6. Enforced in the service, not here,
  // since the DTO can't see the confirmed statutory minimum constant.
  @IsOptional()
  @IsInt()
  @Min(1)
  notice_period_days?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_advance_months?: number;

  // Months of rent the tenant already paid the landlord outside the
  // platform (e.g. cash upfront) — recorded as a confirmed offline payment
  // covering start_date through the end of the Nth month, so it shows up in
  // the ledger, the receipt, paid_through_date and the tenant's dashboard.
  // Added 2026-09-20 (demo feedback). Bounded to two years as a sanity
  // check on typos; intentionally NOT limited by max_advance_months.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  prepaid_months?: number;

  // The day the tenant actually handed over that rent (e.g. the move-in day),
  // if that isn't the day the landlord is recording it. Defaults to today.
  // Only meaningful together with prepaid_months. Becomes the payment's
  // confirmation date — what "Paid on …" shows — while the ledger entry keeps
  // its true creation time as the audit record of when it was entered.
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'prepaid_paid_on must be a date in YYYY-MM-DD format' })
  prepaid_paid_on?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  reminder_first_days_before?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reminder_second_days_before?: number;
}
