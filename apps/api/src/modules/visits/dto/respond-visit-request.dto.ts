import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export const VISIT_RESPOND_ACTIONS = ['accept', 'decline', 'reschedule'] as const;

export class RespondVisitRequestDto {
  @IsIn(VISIT_RESPOND_ACTIONS)
  action!: (typeof VISIT_RESPOND_ACTIONS)[number];

  @ValidateIf((dto: RespondVisitRequestDto) => dto.action === 'accept')
  @IsISO8601()
  confirmed_slot?: string;

  @ValidateIf((dto: RespondVisitRequestDto) => dto.action === 'reschedule')
  @IsISO8601()
  proposed_slot?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  landlord_note?: string;
}
