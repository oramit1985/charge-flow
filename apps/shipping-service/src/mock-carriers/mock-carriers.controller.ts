import { Body, Controller, Post } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

interface ShipmentRequest {
  orderId: string;
  recipientName: string;
  address: {
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    countryCode: string;
  };
  items: Array<{ productId: string; quantity: number }>;
}

interface ShipmentResponse {
  shipmentTrackingNumber: string;
  packages: Array<{ trackingNumber: string }>;
  estimatedDelivery: string;
}

/**
 * Mock FedEx/DHL carrier endpoint for local development.
 * In production this would be replaced by actual carrier API calls.
 */
@Controller('mock-carrier')
export class MockCarriersController {
  @Post('shipments')
  createShipment(@Body() body: ShipmentRequest): ShipmentResponse {
    const trackingNumber = `MOCK${uuidv4().replace(/-/g, '').toUpperCase().slice(0, 12)}`;
    const estimatedDays = 3 + Math.floor(Math.random() * 5); // 3–7 days
    const estimatedDelivery = new Date(
      Date.now() + estimatedDays * 24 * 60 * 60 * 1000,
    ).toISOString().split('T')[0]!;

    // Returns DHL-compatible response format so DhlService can parse it in development
    return {
      shipmentTrackingNumber: trackingNumber,
      packages: [{ trackingNumber }],
      estimatedDelivery,
    };
  }
}
