import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingConsumer } from './billing.consumer';

@Module({
  providers: [BillingService, BillingConsumer],
})
export class BillingModule {}
