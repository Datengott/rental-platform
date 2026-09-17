import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { COMPLAINT_STATUSES } from './list-complaints.dto';

export class UpdateComplaintStatusDto {
  @IsIn(COMPLAINT_STATUSES)
  new_status!: (typeof COMPLAINT_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
