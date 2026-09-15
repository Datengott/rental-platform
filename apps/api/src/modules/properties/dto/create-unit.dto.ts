import { IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Min, MaxLength } from 'class-validator';

export const BILLING_CYCLES = ['monthly', 'quarterly', 'biannual'] as const;

export class CreateUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bathrooms?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  size_sqm?: number;

  // XAF has no minor unit (CLAUDE.md) — whole numbers only, matching the
  // schema's NUMERIC(12,0).
  @IsInt()
  @IsPositive()
  rent_amount!: number;

  // Multi-currency is explicitly out of scope for the MVP (CLAUDE.md) — XAF
  // is the only supported value, matching the DDL default.
  @IsOptional()
  @IsIn(['XAF'])
  currency?: 'XAF';

  @IsOptional()
  @IsIn(BILLING_CYCLES)
  billing_cycle?: (typeof BILLING_CYCLES)[number];

  @IsOptional()
  @IsString()
  description?: string;
}
