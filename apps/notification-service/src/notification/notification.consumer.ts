import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SqsService } from '@app/aws/sqs.service';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import {
  OrderEventType,
  OrderEventEnvelope,
} from '@app/common/events/order-events';
import { NotificationService } from './notification.service';
import { Message } from '@aws-sdk/client-sqs';

const QUEUE_NAME = 'notification-service-all-events';

const ALL_ORDER_EVENTS: OrderEventType[] = [
  OrderEventType.OrderCreated,
  OrderEventType.OrderInvoiced,
  OrderEventType.OrderPaid,
  OrderEventType.OrderPaymentFailed,
  OrderEventType.OrderShipped,
];

@Injectable()
export class NotificationConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(
    private readonly sqsService: SqsService,
    private readonly eventBridgeService: EventBridgeService,
    private readonly notificationService: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.notificationService.verifySenderEmail();

    const queueUrl = await this.sqsService.ensureQueue(QUEUE_NAME);
    const queueArn = await this.sqsService.getQueueArn(queueUrl);

    for (const eventType of ALL_ORDER_EVENTS) {
      await this.eventBridgeService.createRule(eventType, {
        queueArn,
        eventPattern: eventType,
      });
    }

    this.sqsService.startPolling(queueUrl, (msg) => this.handleMessage(msg));
    this.logger.log('Notification consumer started', { queueUrl, events: ALL_ORDER_EVENTS });
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.Body) {
      this.logger.warn('Received empty SQS message', { messageId: message.MessageId });
      return;
    }

    const sqsBody = JSON.parse(message.Body) as { detail?: string } | OrderEventEnvelope;
    const envelope: OrderEventEnvelope =
      'detail' in sqsBody && sqsBody.detail
        ? (JSON.parse(sqsBody.detail) as OrderEventEnvelope)
        : (sqsBody as OrderEventEnvelope);

    this.logger.log('Processing notification event', {
      eventType: envelope.eventType,
      eventId: envelope.eventId,
    });

    await this.notificationService.sendNotification(envelope);
  }
}
