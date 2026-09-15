import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsISO8601, ValidateNested } from 'class-validator';

export class RequestedSlotDto {
  @IsISO8601()
  start!: string;
}

export class CreateVisitRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequestedSlotDto)
  requested_slots!: RequestedSlotDto[];
}
