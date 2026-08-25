import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter, toFieldErrors } from './common/filters/http-exception.filter';
import { ApiException } from './common/exceptions/api.exception';

// Shared between main.ts's real bootstrap and the e2e test setup, so the two
// never drift apart on global prefix/filters/pipes.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors) =>
        new ApiException('VALIDATION_ERROR', 'One or more fields are invalid.', 400, toFieldErrors(errors)),
    }),
  );
  app.enableCors();
}
