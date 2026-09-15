import { Type } from 'class-transformer';
import { IsDateString, IsLatitude, IsLongitude, IsOptional } from 'class-validator';

// Multipart form fields arrive as strings — @Type(() => Number) coerces
// before validation runs (ValidationPipe's `transform: true` applies this).
export class UploadUnitPhotoDto {
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  geo_latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  geo_longitude?: number;

  @IsOptional()
  @IsDateString()
  captured_at?: string;
}
