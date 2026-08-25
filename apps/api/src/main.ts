import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './setup-app';
import { setupSwagger } from './setup-swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  setupSwagger(app);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`API listening on port ${port}`);
  console.log(`API docs at http://localhost:${port}/docs`);
}
void bootstrap();
