import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

/** JSON / form so'rov tanasi chegarasi — taom rasmi (data URL, ~1.5 MB gacha) sig'ishi uchun */
const BODY_LIMIT = '5mb';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });

  // Standart 100 kb chegara rasm yuklashni rad etadi. Bu parserlar listen()dan OLDIN
  // qo'shiladi — Nest o'zining standart json/urlencoded parserlarini shunda qo'shmaydi.
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });

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
  console.log(`[DasturXon] Lokal server: http://localhost:${port}/api`);
}
bootstrap();
