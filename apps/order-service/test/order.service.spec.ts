import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderService } from '../src/order/order.service';
import { OrderRepository } from '../src/order/order.repository';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import { SqsService } from '@app/aws/sqs.service';
import { CreateOrderDto } from '@app/common/dto/order.dto';
import { AppError } from '@app/common/errors/app.error';
import { ErrorCode } from '@app/common/common-types/enums/error-codes';
import { OrderEventType } from '@app/common/common-types';

const mockOrderRepository = {
  ensureTableExists: jest.fn(),
  findByIdempotencyKey: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  updateStatus: jest.fn(),
};

const mockEventBridgeService = {
  publishEvent: jest.fn(),
  createRule: jest.fn(),
};

const mockSqsService = {
  ensureQueue: jest.fn().mockResolvedValue('https://sqs.example.com/queue'),
  getQueueArn: jest.fn().mockResolvedValue('arn:aws:sqs:us-east-1:000000000000:queue'),
  startPolling: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue(undefined),
  getOrThrow: jest.fn().mockImplementation((key: string) => {
    const vals: Record<string, string> = {
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      ORDER_EVENT_BUS_NAME: 'ecommerce-orders',
      ORDERS_TABLE: 'orders',
    };
    return vals[key] ?? '';
  }),
};

const validDto: CreateOrderDto = {
  customerId: 'cust-123',
  items: [{ productId: 'PROD-001', quantity: 2 }],
  shippingAddress: {
    line1: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701',
    countryCode: 'US',
  },
  paymentMethodId: 'pm_test_123',
  currency: 'USD',
};

describe('OrderService', () => {
  let service: OrderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOrderRepository.findByIdempotencyKey.mockResolvedValue(null);
    mockOrderRepository.create.mockImplementation((o) => Promise.resolve(o));
    mockEventBridgeService.publishEvent.mockResolvedValue(undefined);
    mockEventBridgeService.createRule.mockResolvedValue(undefined);
    mockSqsService.ensureQueue.mockResolvedValue('https://sqs.example.com/queue');
    mockSqsService.getQueueArn.mockResolvedValue('arn:aws:sqs:us-east-1:000000000000:queue');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: OrderRepository, useValue: mockOrderRepository },
        { provide: EventBridgeService, useValue: mockEventBridgeService },
        { provide: SqsService, useValue: mockSqsService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
    await service.onModuleInit();
  });

  describe('createOrder — happy path', () => {
    it('creates an order, persists it, and publishes OrderCreated event', async () => {
      const result = await service.createOrder(validDto, 'idem-key-001', 'customer@example.com');

      expect(result.alreadyExisted).toBe(false);
      expect(result.order.status).toBe('PENDING');
      expect(result.order.currency).toBe('USD');
      // PROD-001 unit price = 2999 cents, qty 2 → subtotal = 5998
      expect(result.order.subtotal).toBe(5998);
      // US shipping = 599, US tax = 8% of 5998 = 480 (rounded)
      expect(result.order.shippingCost).toBe(599);
      expect(result.order.tax).toBe(480);
      expect(result.order.total).toBe(7077);

      expect(mockOrderRepository.create).toHaveBeenCalledTimes(1);
      expect(mockEventBridgeService.publishEvent).toHaveBeenCalledWith(
        OrderEventType.OrderCreated,
        expect.objectContaining({ orderId: result.order.orderId }),
      );
    });
  });

  describe('createOrder — idempotency', () => {
    it('returns cached order and does not re-create when idempotency key already exists', async () => {
      const existingOrder = {
        orderId: 'existing-order-id',
        customerId: 'cust-123',
        status: 'PENDING',
        items: [],
        subtotal: 0,
        shippingCost: 0,
        tax: 0,
        total: 0,
        currency: 'USD',
        shippingAddress: validDto.shippingAddress,
        paymentMethodId: 'pm_test_123',
        customerEmail: 'customer@example.com',
        idempotencyKey: 'idem-key-001',
        statusTimeline: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ttl: 0,
      };
      mockOrderRepository.findByIdempotencyKey.mockResolvedValue(existingOrder);

      const result = await service.createOrder(validDto, 'idem-key-001', 'customer@example.com');

      expect(result.alreadyExisted).toBe(true);
      expect(result.order.orderId).toBe('existing-order-id');
      expect(mockOrderRepository.create).not.toHaveBeenCalled();
      expect(mockEventBridgeService.publishEvent).not.toHaveBeenCalled();
    });
  });

  describe('createOrder — error paths', () => {
    it('throws AppError for unknown product', async () => {
      const badDto = {
        ...validDto,
        items: [{ productId: 'UNKNOWN', quantity: 1 }],
      };

      await expect(
        service.createOrder(badDto, 'idem-key-002', 'customer@example.com'),
      ).rejects.toMatchObject({
        code: ErrorCode.ORDER_INVALID_PRODUCT,
      });
    });

    it('throws AppError for unsupported currency', async () => {
      const badDto = { ...validDto, currency: 'JPY' };

      await expect(
        service.createOrder(badDto, 'idem-key-003', 'customer@example.com'),
      ).rejects.toMatchObject({
        code: ErrorCode.ORDER_INVALID_CURRENCY,
      });
    });
  });

  describe('getOrder', () => {
    it('returns the order when it exists', async () => {
      const mockOrder = {
        orderId: 'order-abc',
        customerId: 'cust-123',
        status: 'PAID',
        items: [],
        subtotal: 0,
        shippingCost: 0,
        tax: 0,
        total: 0,
        currency: 'USD',
        shippingAddress: validDto.shippingAddress,
        paymentMethodId: 'pm_test_123',
        customerEmail: 'customer@example.com',
        idempotencyKey: 'key-abc',
        statusTimeline: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ttl: 0,
      };
      mockOrderRepository.findById.mockResolvedValue(mockOrder);

      const result = await service.getOrder('order-abc');
      expect(result.orderId).toBe('order-abc');
      expect(result.status).toBe('PAID');
    });

    it('throws AppError NOT_FOUND when order does not exist', async () => {
      mockOrderRepository.findById.mockResolvedValue(null);

      await expect(service.getOrder('nonexistent')).rejects.toMatchObject({
        code: ErrorCode.ORDER_NOT_FOUND,
      });
    });
  });
});
