import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from '../../../libs/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  const port = process.env['PORT'] ?? '3000';
  await app.listen(parseInt(port, 10));
  logger.log(`Notification service listening on port ${port}`);
}

void bootstrap();
