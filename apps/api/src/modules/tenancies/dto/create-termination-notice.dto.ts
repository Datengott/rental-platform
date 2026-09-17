import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export const NOTICE_REASONS = ['non_payment', 'end_of_term', 'other'] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateTerminationNoticeDto {
  @IsIn(NOTICE_REASONS)
  reason!: (typeof NOTICE_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason_detail?: string;

  @Matches(DATE_ONLY, { message: 'effective_date must be a date in YYYY-MM-DD format' })
  effective_date!: string;
}
