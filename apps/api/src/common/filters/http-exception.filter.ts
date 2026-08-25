import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { FieldError } from '../exceptions/api.exception';

// Global handler that shapes every thrown error into api-specification.md
// Section 1.1's standard format: { error: { code, message, field_errors? } }.
// ApiException already carries a `code`; anything else (framework guards,
// unexpected errors) falls back to a status-derived code.
const STATUS_FALLBACK_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'BUSINESS_RULE_REJECTED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null && 'code' in body) {
        response.status(status).json({ error: body });
        return;
      }

      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);

      response.status(status).json({
        error: {
          code: STATUS_FALLBACK_CODES[status] ?? 'ERROR',
          message: Array.isArray(message) ? message.join('; ') : message,
        },
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
  }
}

export function toFieldErrors(
  errors: { property: string; constraints?: Record<string, string> }[],
): FieldError[] {
  return errors.map((e) => ({
    field: e.property,
    message: Object.values(e.constraints ?? {})[0] ?? 'is invalid',
  }));
}
