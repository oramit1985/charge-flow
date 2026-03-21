import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  SQSClient,
  CreateQueueCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { awsConfig } from './aws.config';

type MessageHandler = (message: Message) => Promise<void>;

interface PollingHandle {
  stop: () => void;
}

@Injectable()
export class SqsService implements OnModuleDestroy {
  private readonly logger = new Logger(SqsService.name);
  private readonly client: SQSClient;
  private readonly handles: PollingHandle[] = [];

  constructor(@Inject(awsConfig.KEY) private readonly aws: ConfigType<typeof awsConfig>) {
    this.client = new SQSClient({
      region: aws.region,
      credentials: {
        accessKeyId: aws.accessKeyId,
        secretAccessKey: aws.secretAccessKey,
      },
      ...(aws.endpointUrl ? { endpoint: aws.endpointUrl } : {}),
    });
  }

  onModuleDestroy(): void {
    this.handles.forEach((h) => h.stop());
  }

  /**
   * Creates an SQS queue (and optionally a DLQ) if it does not already exist.
   * Returns the queue URL.
   */
  async ensureQueue(queueName: string, withDlq = true): Promise<string> {
    let dlqArn: string | undefined;

    if (withDlq) {
      const dlqName = `${queueName}-dlq`;
      const dlqResult = await this.client.send(
        new CreateQueueCommand({ QueueName: dlqName }),
      );
      const dlqUrl = dlqResult.QueueUrl!;
      const dlqAttrs = await this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: dlqUrl,
          AttributeNames: ['QueueArn'],
        }),
      );
      dlqArn = dlqAttrs.Attributes?.['QueueArn'];
      this.logger.log(`DLQ ensured: ${dlqName}`);
    }

    const result = await this.client.send(
      new CreateQueueCommand({
        QueueName: queueName,
        Attributes: dlqArn
          ? {
              RedrivePolicy: JSON.stringify({
                deadLetterTargetArn: dlqArn,
                maxReceiveCount: '5',
              }),
            }
          : undefined,
      }),
    );

    const queueUrl = result.QueueUrl!;
    this.logger.log(`Queue ensured: ${queueName} → ${queueUrl}`);
    return queueUrl;
  }

  /**
   * Returns the ARN for the given queue URL.
   * Used for:
     * permissions
     * integrations between AWS services
   */
  async getQueueArn(queueUrl: string): Promise<string> {
    const result = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['QueueArn'],
      }),
    );
    const arn = result.Attributes?.['QueueArn'];
    if (!arn) throw new Error(`Could not retrieve ARN for queue: ${queueUrl}`);
    return arn;
  }

  /**
   * Begins long-polling the given queue URL, calling handler for each message.
   * Messages are deleted on successful handler completion; left in queue on error.
   */
  startPolling(queueUrl: string, handler: MessageHandler): PollingHandle {
    let active = true;

    const poll = async (): Promise<void> => {
      while (active) {
        try {
          const result = await this.client.send(
            new ReceiveMessageCommand({
              QueueUrl: queueUrl,
              MaxNumberOfMessages: 10,
              WaitTimeSeconds: 20,
              MessageAttributeNames: ['All'],
            }),
          );

          const messages = result.Messages ?? [];

          for (const message of messages) {
            try {
              await handler(message);
              await this.client.send(
                new DeleteMessageCommand({
                  QueueUrl: queueUrl,
                  ReceiptHandle: message.ReceiptHandle!,
                }),
              );
            } catch (handlerError: unknown) {
              this.logger.error('Message handler failed — leaving on queue for retry', {
                messageId: message.MessageId,
                error: handlerError,
              });
            }
          }
        } catch (pollError: unknown) {
          if (active) {
            this.logger.error('SQS poll error', { queueUrl, error: pollError });
            // Brief pause before retrying to avoid tight error loops
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        }
      }
    };

    void poll();

    const handle: PollingHandle = { stop: () => { active = false; } };
    this.handles.push(handle);
    return handle;
  }
}
