import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { LOCAL_UPLOAD_ROOT } from './common/storage/object-storage';
import { AppModule } from './app.module';
import { configureApp } from './setup-app';
import { setupSwagger } from './setup-swagger';

async function bootstrap() {
  // rawBody: true — the payments webhook needs the exact raw request body
  // to verify its HMAC signature; a re-serialized parsed object wouldn't
  // byte-for-byte match what was actually signed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app);
  // Public listing photos only. KYC documents and complaint media live in
  // sibling folders under uploads/ and are intentionally NOT served.
  app.useStaticAssets(join(LOCAL_UPLOAD_ROOT, 'unit-photos'), {
    prefix: '/media/unit-photos/',
    maxAge: '1h',
    index: false,
    dotfiles: 'deny',
  });
  setupSwagger(app);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`API listening on port ${port}`);
  console.log(`API docs at http://localhost:${port}/docs`);
}
void bootstrap();
