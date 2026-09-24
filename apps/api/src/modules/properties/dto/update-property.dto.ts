import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PROPERTY_TYPES } from './create-property.dto';

// PATCH semantics: a field left out is untouched; `null` clears a field that
// is allowed to be empty. address_line and city are required on a property, so
// null is rejected for those (ValidateIf skips validation only when the field
// is *absent*, not when it's null).
export class UpdatePropertyDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string | null;

  @IsOptional()
  @IsIn(PROPERTY_TYPES)
  property_type?: (typeof PROPERTY_TYPES)[number] | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  facilities?: string[];

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  address_line?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  region?: string | null;

  @IsOptional()
  @IsLatitude()
  latitude?: number | null;

  @IsOptional()
  @IsLongitude()
  longitude?: number | null;

  // Optional reason, kept with the change record and shown to the tenant.
  @IsOptional()
  @IsString()
  @MaxLength(300)
  change_note?: string;
}
