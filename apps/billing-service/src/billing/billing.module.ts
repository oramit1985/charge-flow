import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingConsumer } from './billing.consumer';
import { BillingWebhookController } from './billing.webhook.controller';

@Module({
  controllers: [BillingWebhookController],
  providers: [BillingService, BillingConsumer],
})
export class BillingModule {}
