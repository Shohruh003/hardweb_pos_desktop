import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Terminallar lokal tarmoqdan ulanadi — CORS ochiq (lokal muhit)
  app.enableCors({ origin: true, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  // 'queue' marshruti TV/brauzer uchun ildizda qoladi (api prefiksisiz)
  app.setGlobalPrefix('api', { exclude: ['queue', 'queue/data'] });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  // 0.0.0.0 — boshqa kompyuterlardagi terminallar ham ulana olishi uchun
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[HardWeb POS] Lokal server: http://localhost:${port}/api`);
}
bootstrap();
