import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateReminderSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  reminder_first_days_before?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reminder_second_days_before?: number;
}
