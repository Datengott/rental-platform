import { IsIn, IsOptional } from 'class-validator';

export const CONTRACT_LOCALES = ['fr', 'en'] as const;

export class GenerateContractDto {
  @IsOptional()
  @IsIn(CONTRACT_LOCALES)
  locale?: (typeof CONTRACT_LOCALES)[number];
}
