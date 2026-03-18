import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SqsService } from '@app/aws/sqs.service';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import {
  OrderEventType,
  OrderEventEnvelope,
  OrderPaidPayload,
} from '@app/common/events/order-events';
import { ShippingService } from './shipping.service';
import { Message } from '@aws-sdk/client-sqs';

const QUEUE_NAME = 'shipping-service-order-paid';

@Injectable()
export class ShippingConsumer implements OnModuleInit {
  private readonly logger = new Logger(ShippingConsumer.name);

  constructor(
    private readonly sqsService: SqsService,
    private readonly eventBridgeService: EventBridgeService,
    private readonly shippingService: ShippingService,
  ) {}

  async onModuleInit(): Promise<void> {
    const queueUrl = await this.sqsService.ensureQueue(QUEUE_NAME);
    const queueArn = await this.sqsService.getQueueArn(queueUrl);

    await this.eventBridgeService.createRule(OrderEventType.OrderPaid, {
      queueArn,
      eventPattern: OrderEventType.OrderPaid,
    });

    this.sqsService.startPolling(queueUrl, (msg) => this.handleMessage(msg));
    this.logger.log('Shipping consumer started', { queueUrl });
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.Body) {
      this.logger.warn('Received empty SQS message', { messageId: message.MessageId });
      return;
    }

    const sqsBody = JSON.parse(message.Body) as { detail?: string } | OrderEventEnvelope<OrderPaidPayload>;
    const envelope: OrderEventEnvelope<OrderPaidPayload> =
      'detail' in sqsBody && sqsBody.detail
        ? (JSON.parse(sqsBody.detail) as OrderEventEnvelope<OrderPaidPayload>)
        : (sqsBody as OrderEventEnvelope<OrderPaidPayload>);

    if (envelope.eventType !== OrderEventType.OrderPaid) {
      this.logger.warn('Unexpected event type', { eventType: envelope.eventType });
      return;
    }

    this.logger.log('Handling OrderPaid event', {
      eventId: envelope.eventId,
      orderId: envelope.payload.orderId,
    });

    await this.shippingService.processOrderPaid(envelope.payload);
  }
}
