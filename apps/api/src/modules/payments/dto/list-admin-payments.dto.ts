import { IsIn, IsOptional } from 'class-validator';

export const ADMIN_PAYMENT_STATUSES = ['pending', 'confirmed', 'failed', 'reconciling'] as const;

export class ListAdminPaymentsDto {
  @IsOptional()
  @IsIn(ADMIN_PAYMENT_STATUSES)
  status?: (typeof ADMIN_PAYMENT_STATUSES)[number];
}
