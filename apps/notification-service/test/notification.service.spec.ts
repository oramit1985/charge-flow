import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../src/notification/notification.service';
import {
  OrderEventType,
  OrderEventEnvelope,
  OrderCreatedPayload,
  OrderShippedPayload,
} from '@app/common/events/order-events';

// Mock SES at module level
jest.mock('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  SendEmailCommand: jest.fn(),
  VerifyEmailIdentityCommand: jest.fn(),
}));

const mockConfigService = {
  get: jest.fn().mockReturnValue(undefined),
  getOrThrow: jest.fn().mockImplementation((key: string) => {
    const vals: Record<string, string> = {
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      SES_FROM_EMAIL: 'no-reply@example.com',
    };
    return vals[key] ?? '';
  }),
};

const makeEnvelope = <T>(eventType: OrderEventType, payload: T): OrderEventEnvelope<T> => ({
  eventId: 'test-event-id',
  eventType,
  version: '1.0',
  occurredAt: new Date().toISOString(),
  payload,
});

describe('NotificationService', () => {
  let service: NotificationService;
  let sesInstance: { send: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    const { SESClient } = await import('@aws-sdk/client-ses');
    sesInstance = (SESClient as jest.Mock).mock.results[0].value as { send: jest.Mock };
  });

  describe('sendNotification — happy path', () => {
    it('sends an email via SES for OrderCreated event', async () => {
      const payload: OrderCreatedPayload = {
        orderId: 'order-abc-123',
        customerId: 'cust-001',
        customerEmail: 'customer@example.com',
        items: [],
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

      await service.sendNotification(makeEnvelope(OrderEventType.OrderCreated, payload));

      expect(sesInstance.send).toHaveBeenCalledTimes(1);
    });

    it('sends a shipped email with tracking information', async () => {
      const payload: OrderShippedPayload = {
        orderId: 'order-abc-123',
        customerId: 'cust-001',
        customerEmail: 'customer@example.com',
        carrier: 'MockFedEx',
        trackingNumber: 'MOCK123456789',
        estimatedDelivery: '2026-03-25',
      };

      await service.sendNotification(makeEnvelope(OrderEventType.OrderShipped, payload));

      expect(sesInstance.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendNotification — missing email', () => {
    it('skips sending when customerEmail is absent', async () => {
      const payloadWithoutEmail = {
        orderId: 'order-abc-123',
        customerId: 'cust-001',
        // no customerEmail
      };

      await service.sendNotification(
        makeEnvelope(OrderEventType.OrderCreated, payloadWithoutEmail),
      );

      expect(sesInstance.send).not.toHaveBeenCalled();
    });
  });

  describe('sendNotification — SES error', () => {
    it('throws when SES fails', async () => {
      const payload: OrderCreatedPayload = {
        orderId: 'order-abc-123',
        customerId: 'cust-001',
        customerEmail: 'customer@example.com',
        items: [],
        subtotal: 0,
        shippingCost: 0,
        tax: 0,
        total: 0,
        currency: 'USD',
        shippingAddress: {
          line1: '1 Test St',
          city: 'City',
          state: 'ST',
          postalCode: '00000',
          countryCode: 'US',
        },
        paymentMethodId: 'pm_test',
      };

      sesInstance.send.mockRejectedValueOnce(new Error('SES quota exceeded'));

      await expect(
        service.sendNotification(makeEnvelope(OrderEventType.OrderCreated, payload)),
      ).rejects.toThrow('SES quota exceeded');
    });
  });
});
