import {
  OrderEventType,
  OrderCreatedPayload,
  OrderInvoicedPayload,
  OrderPaidPayload,
  OrderPaymentFailedPayload,
  OrderShippedPayload,
} from '@app/common/events/order-events';

export interface EmailContent {
  subject: string;
  body: string;
}

function formatCents(cents: number, currency: string): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency });
}

export function buildEmailContent(
  eventType: OrderEventType,
  payload: unknown,
): EmailContent | null {
  switch (eventType) {
    case OrderEventType.OrderCreated: {
      const p = payload as OrderCreatedPayload;
      return {
        subject: `Order Confirmed – #${p.orderId.slice(0, 8).toUpperCase()}`,
        body: `
Hi there,

Thank you for your order! We've received it and are getting it ready.

Order ID: ${p.orderId}
Total: ${formatCents(p.total, p.currency)}

We'll email you as soon as your invoice is ready.

Thanks,
The Ecommerce Team
        `.trim(),
      };
    }

    case OrderEventType.OrderInvoiced: {
      const p = payload as OrderInvoicedPayload;
      return {
        subject: `Invoice Ready – #${p.orderId.slice(0, 8).toUpperCase()}`,
        body: `
Hi there,

Your invoice is ready.

Order ID: ${p.orderId}
Total: ${formatCents(p.total, p.currency)}
Invoice: ${p.invoiceUrl}

Payment is being processed now.

Thanks,
The Ecommerce Team
        `.trim(),
      };
    }

    case OrderEventType.OrderPaid: {
      const p = payload as OrderPaidPayload;
      return {
        subject: `Payment Confirmed – #${p.orderId.slice(0, 8).toUpperCase()}`,
        body: `
Hi there,

Great news — your payment has been confirmed!

Order ID: ${p.orderId}
Amount charged: ${formatCents(p.total, p.currency)}

Your order is now being prepared for shipment.

Thanks,
The Ecommerce Team
        `.trim(),
      };
    }

    case OrderEventType.OrderPaymentFailed: {
      const p = payload as OrderPaymentFailedPayload;
      return {
        subject: `Payment Failed – Action Required – #${p.orderId.slice(0, 8).toUpperCase()}`,
        body: `
Hi there,

Unfortunately, we were unable to process your payment.

Order ID: ${p.orderId}
Reason: ${p.reason}

Please update your payment method and try again.

Thanks,
The Ecommerce Team
        `.trim(),
      };
    }

    case OrderEventType.OrderShipped: {
      const p = payload as OrderShippedPayload;
      return {
        subject: `Your Order Has Shipped! – #${p.orderId.slice(0, 8).toUpperCase()}`,
        body: `
Hi there,

Your order is on its way!

Order ID: ${p.orderId}
Carrier: ${p.carrier}
Tracking Number: ${p.trackingNumber}
Estimated Delivery: ${p.estimatedDelivery}

Thanks,
The Ecommerce Team
        `.trim(),
      };
    }

    default:
      return null;
  }
}
