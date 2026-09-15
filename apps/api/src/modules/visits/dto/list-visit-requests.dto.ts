import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const VISIT_REQUEST_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'rescheduled',
  'expired',
  'completed',
] as const;

export class ListVisitRequestsDto {
  @IsOptional()
  @IsIn(VISIT_REQUEST_STATUSES)
  status?: (typeof VISIT_REQUEST_STATUSES)[number];

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
