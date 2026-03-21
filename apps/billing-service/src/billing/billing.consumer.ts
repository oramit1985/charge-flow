import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqsService } from '@app/aws/sqs.service';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import { BillingService } from './billing.service';
import { Message } from '@aws-sdk/client-sqs';
import { OrderEventEnvelope, OrderEventType, OrderInvoicedPayload } from '@app/common/common-types';

@Injectable()
export class BillingConsumer implements OnModuleInit {
  private readonly logger = new Logger(BillingConsumer.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly sqsService: SqsService,
    private readonly eventBridgeService: EventBridgeService,
    private readonly billingService: BillingService,
  ) {}

  async onModuleInit(): Promise<void> {
    const queueUrl = await this.sqsService.ensureQueue(
      this.configService.getOrThrow<string>('SQS_QUEUE_NAME'),
    );
    const queueArn = await this.sqsService.getQueueArn(queueUrl);

    await this.eventBridgeService.createRule({ queueArn, eventType: OrderEventType.OrderInvoiced });

    this.sqsService.startPolling(queueUrl, (msg) => this.handleMessage(msg));
    this.logger.log('Billing consumer started', { queueUrl });
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.Body) {
      this.logger.warn('Received empty SQS message', { messageId: message.MessageId });
      return;
    }

    const sqsBody = JSON.parse(message.Body) as { detail?: string } | OrderEventEnvelope<OrderInvoicedPayload>;
    const envelope: OrderEventEnvelope<OrderInvoicedPayload> =
      'detail' in sqsBody && sqsBody.detail
        ? (JSON.parse(sqsBody.detail) as OrderEventEnvelope<OrderInvoicedPayload>)
        : (sqsBody as OrderEventEnvelope<OrderInvoicedPayload>);

    if (envelope.eventType !== OrderEventType.OrderInvoiced) {
      this.logger.warn('Unexpected event type', { eventType: envelope.eventType });
      return;
    }

    this.logger.log('Handling OrderInvoiced event', {
      eventId: envelope.eventId,
      orderId: envelope.payload.orderId,
    });

    await this.billingService.processInvoicedOrder(envelope.payload);
  }
}
