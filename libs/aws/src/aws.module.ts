import { Global, Module } from '@nestjs/common';
import { EventBridgeService } from './eventbridge.service';
import { SqsService } from './sqs.service';

@Global()
@Module({
  providers: [EventBridgeService, SqsService],
  exports: [EventBridgeService, SqsService],
})
export class AwsModule {}
