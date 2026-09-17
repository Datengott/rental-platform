import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './setup-app';
import { setupSwagger } from './setup-swagger';

async function bootstrap() {
  // rawBody: true — the payments webhook needs the exact raw request body
  // to verify its HMAC signature; a re-serialized parsed object wouldn't
  // byte-for-byte match what was actually signed.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  setupSwagger(app);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`API listening on port ${port}`);
  console.log(`API docs at http://localhost:${port}/docs`);
}
void bootstrap();
