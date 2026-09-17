import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const COMPLAINT_CATEGORIES = ['plumbing', 'electrical', 'security', 'noise', 'other'] as const;

export class CreateComplaintDto {
  @IsIn(COMPLAINT_CATEGORIES)
  category!: (typeof COMPLAINT_CATEGORIES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;
}
