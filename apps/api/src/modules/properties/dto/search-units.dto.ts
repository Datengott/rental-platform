import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { UNIT_STATUSES } from './update-unit.dto';
import { PROPERTY_TYPES } from './create-property.dto';

export class SearchUnitsDto {
  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  min_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  max_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms?: number;

  // "N or more bedrooms" — what a search UI usually means by "3+", added
  // alongside the exact-match `bedrooms` filter rather than changing it.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  min_bedrooms?: number;

  @IsOptional()
  @IsIn(PROPERTY_TYPES)
  property_type?: (typeof PROPERTY_TYPES)[number];

  @IsOptional()
  @IsIn(UNIT_STATUSES)
  status?: (typeof UNIT_STATUSES)[number] = 'vacant';

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
