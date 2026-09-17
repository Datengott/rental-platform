import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { COMPLAINT_CATEGORIES } from './create-complaint.dto';

export const COMPLAINT_STATUSES = ['open', 'acknowledged', 'in_progress', 'resolved', 'closed'] as const;

export class ListComplaintsDto {
  @IsOptional()
  @IsUUID()
  unit_id?: string;

  @IsOptional()
  @IsIn(COMPLAINT_STATUSES)
  status?: (typeof COMPLAINT_STATUSES)[number];

  @IsOptional()
  @IsIn(COMPLAINT_CATEGORIES)
  category?: (typeof COMPLAINT_CATEGORIES)[number];
}
