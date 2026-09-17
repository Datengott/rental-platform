import { IsBoolean, IsOptional } from 'class-validator';

export class OptOutChannelDto {
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
