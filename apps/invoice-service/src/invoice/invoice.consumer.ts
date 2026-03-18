import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SqsService } from '@app/aws/sqs.service';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import {
  OrderEventType,
  OrderEventEnvelope,
  OrderCreatedPayload,
} from '@app/common/events/order-events';
import { InvoiceService } from './invoice.service';
import { Message } from '@aws-sdk/client-sqs';

const QUEUE_NAME = 'invoice-service-order-created';

@Injectable()
export class InvoiceConsumer implements OnModuleInit {
  private readonly logger = new Logger(InvoiceConsumer.name);

  constructor(
    private readonly sqsService: SqsService,
    private readonly eventBridgeService: EventBridgeService,
    private readonly invoiceService: InvoiceService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.invoiceService.ensureBucketExists();

    const queueUrl = await this.sqsService.ensureQueue(QUEUE_NAME);
    const queueArn = await this.sqsService.getQueueArn(queueUrl);

    await this.eventBridgeService.createRule(OrderEventType.OrderCreated, {
      queueArn,
      eventPattern: OrderEventType.OrderCreated,
    });

    this.sqsService.startPolling(queueUrl, (msg) => this.handleMessage(msg));
    this.logger.log('Invoice consumer started', { queueUrl });
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.Body) {
      this.logger.warn('Received empty SQS message', { messageId: message.MessageId });
      return;
    }

    const sqsBody = JSON.parse(message.Body) as { detail?: string } | OrderEventEnvelope<OrderCreatedPayload>;
    const envelope: OrderEventEnvelope<OrderCreatedPayload> =
      'detail' in sqsBody && sqsBody.detail
        ? (JSON.parse(sqsBody.detail) as OrderEventEnvelope<OrderCreatedPayload>)
        : (sqsBody as OrderEventEnvelope<OrderCreatedPayload>);

    if (envelope.eventType !== OrderEventType.OrderCreated) {
      this.logger.warn('Unexpected event type', { eventType: envelope.eventType });
      return;
    }

    this.logger.log('Handling OrderCreated event', {
      eventId: envelope.eventId,
      orderId: envelope.payload.orderId,
    });

    await this.invoiceService.processOrderCreated(envelope.payload);
  }
}
