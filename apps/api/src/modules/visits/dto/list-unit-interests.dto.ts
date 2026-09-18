import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const UNIT_INTEREST_STATUSES = ['pending', 'converted'] as const;

export class ListUnitInterestsDto {
  @IsOptional()
  @IsIn(UNIT_INTEREST_STATUSES)
  status?: (typeof UNIT_INTEREST_STATUSES)[number];

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
