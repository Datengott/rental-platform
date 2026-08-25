import { IsIn, IsString, MaxLength } from 'class-validator';

export const KYC_DOCUMENT_TYPES = ['national_id', 'passport', 'cni'] as const;

export class UploadKycDocumentDto {
  @IsIn(KYC_DOCUMENT_TYPES)
  document_type!: (typeof KYC_DOCUMENT_TYPES)[number];

  @IsString()
  @MaxLength(100)
  document_ref!: string;
}
