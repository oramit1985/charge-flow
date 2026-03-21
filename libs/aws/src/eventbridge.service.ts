import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  EventBridgeClient,
  CreateEventBusCommand,
  PutEventsCommand,
  PutRuleCommand,
  PutTargetsCommand,
  PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import { v4 as uuidv4 } from 'uuid';
import { awsConfig } from './aws.config';
import {OrderEventEnvelope, OrderEventType} from "@app/common/common-types";

interface SqsTarget {
  queueArn: string;
  eventType: string;
}

@Injectable()
export class EventBridgeService implements OnModuleInit {
  private readonly logger = new Logger(EventBridgeService.name);
  private readonly client: EventBridgeClient;
  private readonly busName: string;

  constructor(@Inject(awsConfig.KEY) private readonly aws: ConfigType<typeof awsConfig>) {
    this.busName = aws.eventBusName;

    this.client = new EventBridgeClient({
      region: aws.region,
      credentials: {
        accessKeyId: aws.accessKeyId,
        secretAccessKey: aws.secretAccessKey,
      },
      ...(aws.endpointUrl ? { endpoint: aws.endpointUrl } : {}),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureEventBusExists();
  }

  /**
   * Ensures the EventBridge bus exists; creates it if it does not.
   */
  private async ensureEventBusExists(): Promise<void> {
    try {
      await this.client.send(new CreateEventBusCommand({ Name: this.busName }));
      this.logger.log(`EventBridge bus created: ${this.busName}`);
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === 'ResourceAlreadyExistsException') {
        this.logger.log(`EventBridge bus already exists: ${this.busName}`);
      } else {
        this.logger.error('Failed to ensure EventBridge bus exists', { error });
        throw error;
      }
    }
  }

  /**
   * Creates an EventBridge rule that routes events of the given type to the target SQS queue.
   */
  async createRule(target: SqsTarget): Promise<void> {
    const ruleName = `route-${target.eventType}`;
    const eventPattern = JSON.stringify({
      source: ['ecommerce.orders'],
      'detail-type': [target.eventType],
    });

    try {
      await this.client.send(
        new PutRuleCommand({
          Name: ruleName,
          EventBusName: this.busName,
          EventPattern: eventPattern,
          State: 'ENABLED',
        }),
      );

      await this.client.send(
        new PutTargetsCommand({
          Rule: ruleName,
          EventBusName: this.busName,
          Targets: [
            {
              Id: `${ruleName}-target`,
              Arn: target.queueArn,
            },
          ],
        }),
      );

      this.logger.log(`Rule created: ${ruleName} → ${target.queueArn}`);
    } catch (error: unknown) {
      this.logger.error('Failed to create EventBridge rule', { ruleName, error });
      throw error;
    }
  }

  /**
   * Publishes a typed order event to the EventBridge bus.
   */
  async publishEvent<T>(eventType: OrderEventType, payload: T): Promise<void> {
    const envelope: OrderEventEnvelope<T> = {
      eventId: uuidv4(),
      eventType,
      version: '1.0',
      occurredAt: new Date().toISOString(),
      payload,
    };

    const entry: PutEventsRequestEntry = {
      EventBusName: this.busName,
      Source: 'ecommerce.orders',
      DetailType: eventType,
      Detail: JSON.stringify(envelope),
      Time: new Date(),
    };

    try {
      const result = await this.client.send(new PutEventsCommand({ Entries: [entry] }));

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        const failed = result.Entries?.find((e) => e.ErrorCode);
        this.logger.error('EventBridge put event failed', {
          eventType,
          errorCode: failed?.ErrorCode,
          errorMessage: failed?.ErrorMessage,
        });
        throw new Error(`EventBridge publish failed: ${failed?.ErrorMessage}`);
      }

      this.logger.log('Event published', {
        eventType,
        eventId: envelope.eventId,
      });
    } catch (error: unknown) {
      this.logger.error('Failed to publish event', { eventType, error });
      throw error;
    }
  }
}
