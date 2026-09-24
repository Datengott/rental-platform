import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { BILLING_CYCLES } from './create-unit.dto';

// Matches the Unit.status enum in prisma/schema.prisma. Which transitions
// are actually *allowed* from here is business logic in UnitsService, not
// a DTO-level concern — this only validates the value is a known status.
export const UNIT_STATUSES = [
  'draft',
  'vacant',
  'visit_requested',
  'reserved',
  'occupied',
  'notice_given',
] as const;

// PATCH semantics: a field left out is untouched; `null` clears a field that
// may be empty. rent_amount/currency/billing_cycle are required on a unit, so
// null is rejected for them.
export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  bathrooms?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  facilities?: string[];

  @IsOptional()
  @IsNumber()
  @IsPositive()
  size_sqm?: number | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @IsPositive()
  rent_amount?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['XAF'])
  currency?: 'XAF';

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(BILLING_CYCLES)
  billing_cycle?: (typeof BILLING_CYCLES)[number];

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsIn(UNIT_STATUSES)
  status?: (typeof UNIT_STATUSES)[number];

  // Optional reason, kept with the change record and shown to the tenant.
  @IsOptional()
  @IsString()
  @MaxLength(300)
  change_note?: string;
}
