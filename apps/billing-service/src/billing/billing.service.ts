import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import {
  OrderEventType,
  OrderInvoicedPayload,
  OrderPaidPayload,
  OrderPaymentFailedPayload
} from "@app/common/common-types";

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventBridgeService: EventBridgeService,
  ) {
    this.stripe = new Stripe(
      this.configService.getOrThrow<string>('STRIPE_SECRET_KEY'),
      { apiVersion: '2024-04-10' },
    );
  }

  /**
   * Processes payment for an invoiced order using Stripe.
   * Publishes OrderPaid on success, OrderPaymentFailed on failure.
   */
  async processInvoicedOrder(payload: OrderInvoicedPayload): Promise<void> {
    this.logger.log('Processing payment', {
      orderId: payload.orderId,
      total: payload.total,
      currency: payload.currency,
    });

    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
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
        },
      });

      if (paymentIntent.status !== 'succeeded') {
        throw new Error(`Unexpected payment intent status: ${paymentIntent.status}`);
      }

      const paidPayload: OrderPaidPayload = {
        orderId: payload.orderId,
        customerId: payload.customerId,
        customerEmail: payload.customerEmail,
        chargeId: paymentIntent.latest_charge as string ?? paymentIntent.id,
        total: payload.total,
        currency: payload.currency,
        shippingAddress: payload.shippingAddress,
        items: payload.items,
      };

      await this.eventBridgeService.publishEvent(OrderEventType.OrderPaid, paidPayload);
      this.logger.log('Payment succeeded — OrderPaid published', {
        orderId: payload.orderId,
        chargeId: paidPayload.chargeId,
      });
    } catch (error: unknown) {
      const stripeError = error as Stripe.StripeRawError;
      const reason = stripeError.message ?? 'Unknown payment error';
      const declineCode = stripeError.decline_code;

      this.logger.error('Payment failed', {
        orderId: payload.orderId,
        reason,
        declineCode,
      });

      const failedPayload: OrderPaymentFailedPayload = {
        orderId: payload.orderId,
        customerId: payload.customerId,
        customerEmail: payload.customerEmail,
        reason,
        declineCode,
      };

      await this.eventBridgeService.publishEvent(
        OrderEventType.OrderPaymentFailed,
        failedPayload,
      );
    }
  }
}
