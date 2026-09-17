import { IsIn, IsInt, IsOptional, IsPositive, IsUUID, Matches, Min } from 'class-validator';

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

  @IsOptional()
  @IsInt()
  @Min(0)
  reminder_first_days_before?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reminder_second_days_before?: number;
}
