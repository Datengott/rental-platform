import { IsString, MaxLength, MinLength } from 'class-validator';

export class OptInChannelDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  channel_identifier!: string;
}
