import { IsIn, IsInt, IsPositive, Matches } from 'class-validator';

export const PAYMENT_PROVIDERS = ['campay', 'monetbil'] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreatePaymentDto {
  // XAF has no minor unit (CLAUDE.md) — whole numbers only.
  @IsInt()
  @IsPositive()
  amount!: number;

  // Multi-currency is out of scope for the MVP (CLAUDE.md).
  @IsIn(['XAF'])
  currency!: 'XAF';

  @Matches(DATE_ONLY, { message: 'period_start must be a date in YYYY-MM-DD format' })
  period_start!: string;

  @Matches(DATE_ONLY, { message: 'period_end must be a date in YYYY-MM-DD format' })
  period_end!: string;

  @IsIn(PAYMENT_PROVIDERS)
  provider!: (typeof PAYMENT_PROVIDERS)[number];
}
