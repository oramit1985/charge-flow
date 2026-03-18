import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { ShippingService } from '../src/shipping/shipping.service';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import { OrderEventType, OrderPaidPayload } from '@app/common/events/order-events';
import { AxiosResponse } from 'axios';

const mockEventBridgeService = {
  publishEvent: jest.fn().mockResolvedValue(undefined),
};

const mockHttpService = {
  post: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'MOCK_CARRIER_BASE_URL') return 'http://localhost:3000';
    return undefined;
  }),
  getOrThrow: jest.fn().mockReturnValue('test'),
};

const samplePayload: OrderPaidPayload = {
  orderId: 'order-test-001',
  customerId: 'cust-001',
  customerEmail: 'cust@example.com',
  chargeId: 'ch_test_abc',
  total: 7077,
  currency: 'USD',
  shippingAddress: {
    line1: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701',
    countryCode: 'US',
  },
  items: [{ productId: 'PROD-001', quantity: 2, unitPrice: 2999, name: 'Widget Pro' }],
};

const mockCarrierResponse = {
  trackingNumber: 'MOCK123456789ABC',
  carrier: 'MockFedEx',
  estimatedDelivery: '2026-03-25',
};

describe('ShippingService', () => {
  let service: ShippingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingService,
        { provide: EventBridgeService, useValue: mockEventBridgeService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<ShippingService>(ShippingService);
  });

  describe('processOrderPaid — happy path', () => {
    it('calls carrier API and publishes OrderShipped event', async () => {
      const axiosResponse: AxiosResponse = {
        data: mockCarrierResponse,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      };
      mockHttpService.post.mockReturnValue(of(axiosResponse));

      await service.processOrderPaid(samplePayload);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        expect.stringContaining('/mock-carrier/shipments'),
        expect.objectContaining({ orderId: samplePayload.orderId }),
      );

      expect(mockEventBridgeService.publishEvent).toHaveBeenCalledWith(
        OrderEventType.OrderShipped,
        expect.objectContaining({
          orderId: samplePayload.orderId,
          trackingNumber: mockCarrierResponse.trackingNumber,
          carrier: mockCarrierResponse.carrier,
        }),
      );
    });
  });

  describe('processOrderPaid — carrier failure', () => {
    it('throws AppError when carrier API returns an error', async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error('Carrier API unavailable')),
      );

      await expect(service.processOrderPaid(samplePayload)).rejects.toMatchObject({
        code: 'SHIPPING_FAILED',
      });

      expect(mockEventBridgeService.publishEvent).not.toHaveBeenCalled();
    });
  });
});
