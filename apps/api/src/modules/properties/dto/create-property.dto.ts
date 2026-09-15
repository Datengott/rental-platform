import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePropertyDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsString()
  address_line!: string;

  @IsString()
  @MaxLength(80)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  region?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}
