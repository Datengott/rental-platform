import { HttpException, HttpStatus } from '@nestjs/common';

export interface FieldError {
  field: string;
  message: string;
}

// Carries the error `code` string used throughout api-specification.md
// (e.g. INVALID_OTP, NOTICE_PERIOD_BELOW_STATUTORY_MINIMUM) so the global
// exception filter can shape it into the standard { error: { code, ... } }
// response documented in Section 1.1. Codes referenced by name in the PRD's
// acceptance criteria are contract, not suggestion — don't rename them.
export class ApiException extends HttpException {
  constructor(
    code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    fieldErrors?: FieldError[],
  ) {
    super({ code, message, field_errors: fieldErrors }, status);
  }
}
