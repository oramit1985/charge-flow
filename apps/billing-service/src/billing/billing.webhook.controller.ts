import { Controller, Headers, HttpCode, Logger, Post, RawBodyRequest, Req } from '@nestjs/common';
import { Request } from 'express';
import { BillingService } from './billing.service';

@Controller('webhooks')
export class BillingWebhookController {
  private readonly logger = new Logger(BillingWebhookController.name);

  constructor(private readonly billingService: BillingService) {}

  /**
   * Stripe webhook endpoint.
   *
   * Stripe sends signed POST requests here for payment lifecycle events.
   * The raw body is required for signature verification — NestJS must be
   * bootstrapped with { rawBody: true } for req.rawBody to be populated.
   */
  @Post('stripe')
  @HttpCode(200)
  async handleStripeWebhook(
    @Headers('stripe-signature') sig: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<void> {
    this.logger.log('Stripe webhook received');
    await this.billingService.handleStripeWebhook(sig, req.rawBody!);
  }
}
