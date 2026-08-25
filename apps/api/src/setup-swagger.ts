import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Only wired into the real bootstrap (main.ts), not the e2e test setup —
// generating the OpenAPI document is pure overhead for tests and isn't
// part of what they verify.
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Rental Platform API')
    .setDescription(
      'REST API for the Cameroon rental platform (landlords + tenants). ' +
        'Matches docs/api-specification.md — that document is the source of truth; ' +
        'this UI is generated from the same controllers/DTOs for interactive exploration.',
    )
    .setVersion('1')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
