import { Global, Module } from '@nestjs/common';
import { EventBridgeService } from './eventbridge.service';
import { SqsService } from './sqs.service';
import { IdempotencyService } from './idempotency.service';

@Global()
@Module({
  providers: [EventBridgeService, SqsService, IdempotencyService],
  exports: [EventBridgeService, SqsService, IdempotencyService],
})
export class AwsModule {}
