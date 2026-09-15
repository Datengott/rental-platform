import { IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

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

export class UpdateUnitDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  rent_amount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(UNIT_STATUSES)
  status?: (typeof UNIT_STATUSES)[number];
}
