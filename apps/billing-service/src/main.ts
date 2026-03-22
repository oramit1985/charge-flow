import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from '@app/common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
    rawBody: true, // required for Stripe webhook signature verification
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  const port = process.env['PORT'] ?? '3000';
  await app.listen(parseInt(port, 10));
  logger.log(`Billing service listening on port ${port}`);
}

void bootstrap();
