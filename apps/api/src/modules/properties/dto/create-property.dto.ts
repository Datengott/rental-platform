import { ArrayMaxSize, IsArray, IsIn, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';

export const PROPERTY_TYPES = ['residential', 'commercial', 'mixed_use'] as const;

export class CreatePropertyDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsIn(PROPERTY_TYPES)
  property_type?: (typeof PROPERTY_TYPES)[number];

  // Freeform tags (e.g. "gated", "generator", "borehole",
  // "security_personnel") — see the comment on Property.facilities.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  facilities?: string[];

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
