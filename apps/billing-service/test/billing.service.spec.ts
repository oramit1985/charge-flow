import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BillingService } from '../src/billing/billing.service';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import { OrderEventType, OrderInvoicedPayload } from '@app/common/common-types';

// Mock stripe at module level
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn(),
    },
  }));
});

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
      STRIPE_SECRET_KEY: 'sk_test_placeholder',
    };
    return vals[key] ?? '';
  }),
};

const samplePayload: OrderInvoicedPayload = {
  orderId: 'order-test-001',
  customerId: 'cust-001',
  customerEmail: 'cust@example.com',
  invoiceUrl: 'https://s3.example.com/invoices/order-test-001/invoice.pdf',
  total: 7077,
  currency: 'USD',
  paymentMethodId: 'pm_test_123',
};

describe('BillingService', () => {
  let service: BillingService;
  let stripeInstance: { paymentIntents: { create: jest.Mock } };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: EventBridgeService, useValue: mockEventBridgeService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    // Access the mocked stripe instance
    const Stripe = (await import('stripe')).default as unknown as jest.Mock;
    stripeInstance = Stripe.mock.results[0].value as { paymentIntents: { create: jest.Mock } };
  });

  describe('processInvoicedOrder — happy path', () => {
    it('charges via Stripe and publishes OrderPaid event', async () => {
      stripeInstance.paymentIntents.create.mockResolvedValue({
        status: 'succeeded',
        id: 'pi_test_123',
        latest_charge: 'ch_test_abc',
      });

      await service.processInvoicedOrder(samplePayload);

      expect(stripeInstance.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: samplePayload.total,
          currency: samplePayload.currency.toLowerCase(),
          payment_method: samplePayload.paymentMethodId,
          confirm: true,
        }),
      );

      expect(mockEventBridgeService.publishEvent).toHaveBeenCalledWith(
        OrderEventType.OrderPaid,
        expect.objectContaining({ orderId: samplePayload.orderId }),
      );
    });
  });

  describe('processInvoicedOrder — payment failure', () => {
    it('publishes OrderPaymentFailed when Stripe rejects the charge', async () => {
      const stripeError = Object.assign(new Error('Your card was declined.'), {
        decline_code: 'insufficient_funds',
      });
      stripeInstance.paymentIntents.create.mockRejectedValue(stripeError);

      await service.processInvoicedOrder(samplePayload);

      expect(mockEventBridgeService.publishEvent).toHaveBeenCalledWith(
        OrderEventType.OrderPaymentFailed,
        expect.objectContaining({
          orderId: samplePayload.orderId,
          reason: 'Your card was declined.',
          declineCode: 'insufficient_funds',
        }),
      );
    });
  });
});
