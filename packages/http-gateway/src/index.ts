#!/usr/bin/env node
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  const port = parseInt(process.env['JARVIS_API_PORT'] ?? '3100', 10);
  await app.listen(port);
  console.log(`JARVIS HTTP Gateway running on http://localhost:${port}`);
}

bootstrap();
