import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // 'dashboard' direktor sahifasi ildizda qoladi (api prefiksisiz)
  app.setGlobalPrefix('api', { exclude: ['dashboard'] });

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[HardWeb Cloud] Bulut serveri: http://localhost:${port}/api`);
}
bootstrap();
