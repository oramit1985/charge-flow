import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import {
  SESClient,
  SendEmailCommand,
  VerifyEmailIdentityCommand,
} from '@aws-sdk/client-ses';
import {
  OrderEventType,
  OrderEventEnvelope,
} from '@app/common/events/order-events';
import { buildEmailContent } from './email-templates';
import { awsConfig } from '@app/aws';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly sesClient: SESClient;
  private readonly fromEmail: string;

  constructor(
    @Inject(awsConfig.KEY) private readonly aws: ConfigType<typeof awsConfig>,
    private readonly configService: ConfigService,
  ) {
    this.fromEmail = this.configService.getOrThrow<string>('SES_FROM_EMAIL');

    this.sesClient = new SESClient({
      region: aws.region,
      credentials: {
        accessKeyId: aws.accessKeyId,
        secretAccessKey: aws.secretAccessKey,
      },
      ...(aws.endpointUrl ? { endpoint: aws.endpointUrl } : {}),
    });
  }

  /**
   * Verifies the sender email identity with SES (required for LocalStack/sandbox).
   */
  async verifySenderEmail(): Promise<void> {
    try {
      await this.sesClient.send(
        new VerifyEmailIdentityCommand({ EmailAddress: this.fromEmail }),
      );
      this.logger.log(`SES sender email verified: ${this.fromEmail}`);
    } catch (error: unknown) {
      this.logger.warn('Could not verify SES sender email', { error });
    }
  }

  /**
   * Processes an order event and sends an email to the customer.
   */
  async sendNotification(envelope: OrderEventEnvelope): Promise<void> {
    const { eventType, payload } = envelope;
    const typedPayload = payload as { customerEmail?: string };
    const toEmail = typedPayload.customerEmail;

    if (!toEmail) {
      this.logger.warn('No customer email in event payload — skipping notification', {
        eventType,
        eventId: envelope.eventId,
      });
      return;
    }

    const emailContent = buildEmailContent(eventType as OrderEventType, payload);
    if (!emailContent) {
      this.logger.warn('No email template for event type', { eventType });
      return;
    }

    try {
      await this.sesClient.send(
        new SendEmailCommand({
          Source: this.fromEmail,
          Destination: { ToAddresses: [toEmail] },
          Message: {
            Subject: { Data: emailContent.subject, Charset: 'UTF-8' },
            Body: { Text: { Data: emailContent.body, Charset: 'UTF-8' } },
          },
        }),
      );

      this.logger.log('Notification email sent', {
        eventType,
        to: toEmail,
        subject: emailContent.subject,
      });
    } catch (error: unknown) {
      this.logger.error('Failed to send notification email', {
        eventType,
        to: toEmail,
        error,
      });
      throw error;
    }
  }
}
