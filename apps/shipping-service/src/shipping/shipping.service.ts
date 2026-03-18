import { Injectable, Logger } from '@nestjs/common';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import {
  OrderEventType,
  OrderPaidPayload,
  OrderShippedPayload,
} from '@app/common/common-types';
import { DhlService } from './dhl.service';

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly dhlService: DhlService,
    private readonly eventBridgeService: EventBridgeService,
  ) {}

  /**
   * Requests a shipment from DHL and publishes the OrderShipped event.
   */
  async processOrderPaid(payload: OrderPaidPayload): Promise<void> {
    this.logger.log('Requesting shipment', { orderId: payload.orderId });

    const contentDescription = payload.items
      .map((i) => `${i.name} x${i.quantity}`)
      .join(', ');

    const shipment = await this.dhlService.createShipment({
      orderId: payload.orderId,
      recipientName: payload.customerId,
      recipientEmail: payload.customerEmail,
      address: payload.shippingAddress,
      contentDescription,
    });

    const shippedPayload: OrderShippedPayload = {
      orderId: payload.orderId,
      customerId: payload.customerId,
      customerEmail: payload.customerEmail,
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      estimatedDelivery: shipment.estimatedDelivery,
    };

    await this.eventBridgeService.publishEvent(OrderEventType.OrderShipped, shippedPayload);

    this.logger.log('OrderShipped event published', {
      orderId: payload.orderId,
      trackingNumber: shipment.trackingNumber,
    });
  }
}
