import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const ADMIN_ACTION_TARGET_TYPES = ['user', 'unit'] as const;

// Matches GET /admin/audit-log?target_type=&target_id=&cursor= from
// api-specification.md Section 11.
export class ListAuditLogDto {
  @IsOptional()
  @IsIn(ADMIN_ACTION_TARGET_TYPES)
  target_type?: (typeof ADMIN_ACTION_TARGET_TYPES)[number];

  @IsOptional()
  @IsUUID()
  target_id?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;
}
