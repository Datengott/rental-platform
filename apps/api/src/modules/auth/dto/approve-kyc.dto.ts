import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const KYC_TIERS = ['unverified', 'id_verified', 'ownership_verified'] as const;

export class ApproveKycDto {
  @IsIn(KYC_TIERS)
  new_tier!: (typeof KYC_TIERS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
