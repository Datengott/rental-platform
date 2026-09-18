import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, Min, MaxLength } from 'class-validator';

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

  // Freeform tags (e.g. "ac", "wifi", "hot_water", "furnished") — see the
  // comment on Unit.facilities.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  facilities?: string[];

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

  // Bulk-create N independent, identical units in one call (e.g. 50 studio
  // units in the same building) instead of the landlord repeating this
  // form 50 times — added 2026-09-18 after demo feedback. Each created
  // unit is its own row with its own id/status/photos/tenancy lifecycle;
  // this is purely a creation-time convenience, not a "quantity" field on
  // a single unit. Omitted or 1 keeps the exact single-unit response
  // shape every existing caller already expects (see
  // PropertiesService.createUnit).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  quantity?: number;
}
