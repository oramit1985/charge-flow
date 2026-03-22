import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import { IdempotencyService } from '@app/aws/idempotency.service';
import {
  OrderEventType,
  OrderInvoicedPayload,
  OrderPaidPayload,
  OrderPaymentFailedPayload,
} from '@app/common/common-types';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventBridgeService: EventBridgeService,
    private readonly idempotencyService: IdempotencyService,
  ) {
    this.stripe = new Stripe(
      this.configService.getOrThrow<string>('STRIPE_SECRET_KEY'),
      { apiVersion: '2024-04-10' },
    );
  }

  /**
   * Creates a Stripe PaymentIntent for an invoiced order.
   *
   * Intentionally does NOT publish OrderPaid here. The authoritative
   * confirmation comes via the Stripe webhook (handleStripeWebhook), which
   * covers both instant card confirmations and async flows like 3DS.
   *
   * The full order payload is stored in PaymentIntent metadata so the webhook
   * handler can reconstruct OrderPaidPayload without querying another service.
   */
  async processInvoicedOrder(payload: OrderInvoicedPayload): Promise<void> {
    this.logger.log('Creating payment intent', {
      orderId: payload.orderId,
      total: payload.total,
      currency: payload.currency,
    });

    // idempotencyKey ensures Stripe returns the same PaymentIntent on retries —
    // safe to call multiple times, no double charge.
    await this.stripe.paymentIntents.create(
      {
        amount: payload.total,
        currency: payload.currency.toLowerCase(),
        payment_method: payload.paymentMethodId,
        confirm: true,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
        metadata: {
          orderId: payload.orderId,
          customerId: payload.customerId,
          customerEmail: payload.customerEmail,
          total: String(payload.total),
          currency: payload.currency,
          shippingAddressJson: JSON.stringify(payload.shippingAddress),
          itemsJson: JSON.stringify(payload.items),
        },
      },
      { idempotencyKey: payload.orderId },
    );

    this.logger.log('Payment intent created — awaiting Stripe webhook', {
      orderId: payload.orderId,
    });
  }

  /**
   * Validates and dispatches an incoming Stripe webhook event.
   * The raw request body is required for signature verification.
   */
  async handleStripeWebhook(sig: string, rawBody: Buffer): Promise<void> {
    const webhookSecret = this.configService.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (error: unknown) {
      this.logger.error('Stripe webhook signature verification failed', { error });
      throw error;
    }

    // Use Stripe's event ID as the idempotency key — Stripe can deliver the
    // same webhook multiple times, and each delivery carries the same event.id.
    await this.idempotencyService.runOnce(event.id, async () => {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
          break;
        default:
          this.logger.log('Unhandled Stripe event type — ignoring', { type: event.type });
      }
    });
  }

  private async handlePaymentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const { orderId, customerId, customerEmail, total, currency, shippingAddressJson, itemsJson } =
      intent.metadata;

    const paidPayload: OrderPaidPayload = {
      orderId,
      customerId,
      customerEmail,
      chargeId: (intent.latest_charge as string) ?? intent.id,
      total: parseInt(total, 10),
      currency,
      shippingAddress: JSON.parse(shippingAddressJson) as OrderPaidPayload['shippingAddress'],
      items: JSON.parse(itemsJson) as OrderPaidPayload['items'],
    };

    // Deterministic eventId: same orderId always produces the same OrderPaid
    // eventId, so shipping-service deduplicates it even if we publish twice.
    await this.eventBridgeService.publishEvent(
      OrderEventType.OrderPaid,
      paidPayload,
      `OrderPaid:${orderId}`,
    );
    this.logger.log('OrderPaid published via webhook', { orderId, chargeId: paidPayload.chargeId });
  }

  private async handlePaymentFailed(intent: Stripe.PaymentIntent): Promise<void> {
    const { orderId, customerId, customerEmail } = intent.metadata;
    const lastError = intent.last_payment_error;

    const failedPayload: OrderPaymentFailedPayload = {
      orderId,
      customerId,
      customerEmail,
      reason: lastError?.message ?? 'Unknown payment error',
      declineCode: lastError?.decline_code ?? undefined,
    };

    await this.eventBridgeService.publishEvent(
      OrderEventType.OrderPaymentFailed,
      failedPayload,
      `OrderPaymentFailed:${orderId}`,
    );
    this.logger.error('OrderPaymentFailed published via webhook', {
      orderId,
      reason: failedPayload.reason,
    });
  }
}
