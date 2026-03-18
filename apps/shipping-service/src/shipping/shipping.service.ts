import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import {
  OrderEventType,
  OrderPaidPayload,
  OrderShippedPayload,
} from '@app/common/events/order-events';
import { AppError } from '@app/common/errors/app.error';
import { ErrorCode } from '@app/common/errors/error-codes.enum';

interface CarrierShipmentResponse {
  trackingNumber: string;
  carrier: string;
  estimatedDelivery: string;
}

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);
  private readonly carrierBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly eventBridgeService: EventBridgeService,
  ) {
    this.carrierBaseUrl =
      this.configService.get<string>('MOCK_CARRIER_BASE_URL') ?? 'http://localhost:3000';
  }

  /**
   * Requests a shipment from the carrier API and publishes the OrderShipped event.
   */
  async processOrderPaid(payload: OrderPaidPayload): Promise<void> {
    this.logger.log('Requesting shipment', { orderId: payload.orderId });

    let shipmentResponse: CarrierShipmentResponse;
    try {
      const response = await firstValueFrom(
        this.httpService.post<CarrierShipmentResponse>(
          `${this.carrierBaseUrl}/mock-carrier/shipments`,
          {
            orderId: payload.orderId,
            recipientName: payload.customerId,
            address: payload.shippingAddress,
            items: payload.items,
          },
        ),
      );
      shipmentResponse = response.data;
    } catch (error: unknown) {
      this.logger.error('Carrier API call failed', { orderId: payload.orderId, error });
      throw new AppError(
        ErrorCode.SHIPPING_FAILED,
        'Failed to create shipment with carrier',
        500,
        { orderId: payload.orderId },
      );
    }

    const shippedPayload: OrderShippedPayload = {
      orderId: payload.orderId,
      customerId: payload.customerId,
      customerEmail: payload.customerEmail,
      carrier: shipmentResponse.carrier,
      trackingNumber: shipmentResponse.trackingNumber,
      estimatedDelivery: shipmentResponse.estimatedDelivery,
    };

    await this.eventBridgeService.publishEvent(OrderEventType.OrderShipped, shippedPayload);

    this.logger.log('OrderShipped event published', {
      orderId: payload.orderId,
      trackingNumber: shipmentResponse.trackingNumber,
      carrier: shipmentResponse.carrier,
    });
  }
}
