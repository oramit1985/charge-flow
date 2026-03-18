import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InvoiceService } from '../src/invoice/invoice.service';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import { OrderCreatedPayload, OrderEventType } from '@app/common/common-types';

// Mock S3Client at module level
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn(),
  CreateBucketCommand: jest.fn(),
  HeadBucketCommand: jest.fn(),
}));

const mockEventBridgeService = {
  publishEvent: jest.fn().mockResolvedValue(undefined),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue(undefined),
  getOrThrow: jest.fn().mockImplementation((key: string) => {
    const vals: Record<string, string> = {
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      S3_INVOICES_BUCKET: 'invoices',
    };
    return vals[key] ?? '';
  }),
};

const samplePayload: OrderCreatedPayload = {
  orderId: 'order-test-001',
  customerId: 'cust-001',
  customerEmail: 'cust@example.com',
  items: [{ productId: 'PROD-001', quantity: 2, unitPrice: 2999, name: 'Widget Pro' }],
  subtotal: 5998,
  shippingCost: 599,
  tax: 480,
  total: 7077,
  currency: 'USD',
  shippingAddress: {
    line1: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701',
    countryCode: 'US',
  },
  paymentMethodId: 'pm_test_123',
};

describe('InvoiceService', () => {
  let service: InvoiceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceService,
        { provide: EventBridgeService, useValue: mockEventBridgeService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<InvoiceService>(InvoiceService);
  });

  describe('processOrderCreated — happy path', () => {
    it('generates PDF, uploads to S3, and publishes OrderInvoiced event', async () => {
      await service.processOrderCreated(samplePayload);

      expect(mockEventBridgeService.publishEvent).toHaveBeenCalledWith(
        OrderEventType.OrderInvoiced,
        expect.objectContaining({
          orderId: samplePayload.orderId,
          total: samplePayload.total,
          paymentMethodId: samplePayload.paymentMethodId,
        }),
      );
    });
  });

  describe('processOrderCreated — error path', () => {
    it('throws AppError when S3 upload fails', async () => {
      // Simulate S3 upload failure by making the S3 client send throw
      const { S3Client } = await import('@aws-sdk/client-s3');
      (S3Client as jest.Mock).mockImplementationOnce(() => ({
        send: jest.fn()
          .mockResolvedValueOnce({}) // HeadBucketCommand succeeds
          .mockRejectedValueOnce(new Error('S3 upload failed')), // PutObjectCommand fails
      }));

      // Re-create service with failing S3
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          InvoiceService,
          { provide: EventBridgeService, useValue: mockEventBridgeService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const failingService = module.get<InvoiceService>(InvoiceService);

      await expect(failingService.processOrderCreated(samplePayload)).rejects.toThrow();
    });
  });
});
