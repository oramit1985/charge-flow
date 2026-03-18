import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  OrderRepository,
  Order,
  OrderStatus,
} from './order.repository';
import { EventBridgeService } from '@app/aws/eventbridge.service';
import { SqsService } from '@app/aws/sqs.service';
import { CreateOrderDto, OrderResponseDto } from '@app/common/dto/order.dto';
import {
  OrderEventType,
  OrderEventEnvelope,
  OrderCreatedPayload,
  OrderInvoicedPayload,
  OrderPaidPayload,
  OrderPaymentFailedPayload,
  OrderShippedPayload,
} from '@app/common/events/order-events';
import { AppError } from '@app/common/errors/app.error';
import { ErrorCode } from '@app/common/errors/error-codes.enum';
import {
  PRODUCT_CATALOG,
  TAX_RATES,
  DEFAULT_TAX_RATE,
  SHIPPING_COSTS,
  DEFAULT_SHIPPING_COST,
  SUPPORTED_CURRENCIES,
} from './catalog';
import { ConfigService } from '@nestjs/config';
import { Message } from '@aws-sdk/client-sqs';

/** Header name for idempotency key. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** TTL: 90 days from now in epoch seconds. */
const TTL_SECONDS = 90 * 24 * 60 * 60;

@Injectable()
export class OrderService implements OnModuleInit {
  private readonly logger = new Logger(OrderService.name);
  private readonly orderServiceQueueUrl: string | null = null;

  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly eventBridgeService: EventBridgeService,
    private readonly sqsService: SqsService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.orderRepository.ensureTableExists();
    await this.setupStatusUpdateQueue();
  }

  /**
   * Creates the order-service SQS queue that receives status update events
   * from downstream services (invoice, billing, shipping).
   */
  private async setupStatusUpdateQueue(): Promise<void> {
    try {
      const queueUrl = await this.sqsService.ensureQueue('order-service-status-updates');
      const queueArn = await this.sqsService.getQueueArn(queueUrl);

      const statusUpdateEvents: OrderEventType[] = [
        OrderEventType.OrderInvoiced,
        OrderEventType.OrderPaid,
        OrderEventType.OrderPaymentFailed,
        OrderEventType.OrderShipped,
      ];

      for (const eventType of statusUpdateEvents) {
        await this.eventBridgeService.createRule(eventType, {
          queueArn,
          eventPattern: eventType,
        });
      }

      this.sqsService.startPolling(queueUrl, (msg) => this.handleStatusUpdateMessage(msg));
      this.logger.log('Status update queue wired up', { queueUrl });
    } catch (error: unknown) {
      this.logger.error('Failed to set up status update queue', { error });
    }
  }

  /**
   * Handles incoming status-update events from SQS and updates DynamoDB accordingly.
   */
  private async handleStatusUpdateMessage(message: Message): Promise<void> {
    if (!message.Body) {
      this.logger.warn('Received SQS message with no body', { messageId: message.MessageId });
      return;
    }

    // EventBridge wraps the detail in its own envelope when routing to SQS
    const sqsBody = JSON.parse(message.Body) as { detail: string } | OrderEventEnvelope;
    const envelope: OrderEventEnvelope =
      'detail' in sqsBody ? (JSON.parse(sqsBody.detail as string) as OrderEventEnvelope) : sqsBody;

    const { eventType, payload } = envelope;
    this.logger.log('Processing status update event', { eventType, orderId: (payload as { orderId?: string }).orderId });

    switch (eventType) {
      case OrderEventType.OrderInvoiced: {
        const p = payload as OrderInvoicedPayload;
        await this.orderRepository.updateStatus(p.orderId, 'INVOICED', {
          invoiceUrl: p.invoiceUrl,
        });
        break;
      }
      case OrderEventType.OrderPaid: {
        const p = payload as OrderPaidPayload;
        await this.orderRepository.updateStatus(p.orderId, 'PAID');
        break;
      }
      case OrderEventType.OrderPaymentFailed: {
        const p = payload as OrderPaymentFailedPayload;
        await this.orderRepository.updateStatus(p.orderId, 'FAILED');
        this.logger.error('Order payment failed', { orderId: p.orderId, reason: p.reason });
        break;
      }
      case OrderEventType.OrderShipped: {
        const p = payload as OrderShippedPayload;
        await this.orderRepository.updateStatus(p.orderId, 'SHIPPED', {
          shipment: {
            carrier: p.carrier,
            trackingNumber: p.trackingNumber,
            estimatedDelivery: p.estimatedDelivery,
          },
        });
        break;
      }
      default:
        this.logger.warn('Unrecognised event type in status update queue', { eventType });
    }
  }

  /**
   * Creates a new order.
   * Validates idempotency, verifies product prices server-side, calculates totals,
   * persists to DynamoDB and publishes the OrderCreated event.
   *
   * @param dto - Validated CreateOrderDto
   * @param idempotencyKey - Client-supplied idempotency key (required)
   * @param customerEmail - Customer email address (resolved from auth context in production)
   * @returns The persisted order as an OrderResponseDto
   */
  async createOrder(
    dto: CreateOrderDto,
    idempotencyKey: string,
    customerEmail: string,
  ): Promise<{ order: OrderResponseDto; alreadyExisted: boolean }> {
    // Idempotency check
    const existing = await this.orderRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      this.logger.log('Duplicate request — returning cached order', {
        orderId: existing.orderId,
        idempotencyKey,
      });
      return { order: this.toResponseDto(existing), alreadyExisted: true };
    }

    // Validate currency
    if (!SUPPORTED_CURRENCIES.has(dto.currency)) {
      throw AppError.badRequest(
        ErrorCode.ORDER_INVALID_CURRENCY,
        `Unsupported currency: ${dto.currency}`,
        { supportedCurrencies: [...SUPPORTED_CURRENCIES] },
      );
    }

    // Server-side price verification and total calculation
    let subtotal = 0;
    const resolvedItems = dto.items.map((item) => {
      const product = PRODUCT_CATALOG.get(item.productId);
      if (!product) {
        throw AppError.badRequest(
          ErrorCode.ORDER_INVALID_PRODUCT,
          `Unknown product: ${item.productId}`,
          { productId: item.productId },
        );
      }
      subtotal += product.unitPrice * item.quantity;
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: product.unitPrice,
        name: product.name,
      };
    });

    const countryCode = dto.shippingAddress.countryCode;
    const shippingCost = SHIPPING_COSTS.get(countryCode) ?? DEFAULT_SHIPPING_COST;
    const taxRate = TAX_RATES.get(countryCode) ?? DEFAULT_TAX_RATE;
    const tax = Math.round(subtotal * taxRate);
    const total = subtotal + shippingCost + tax;

    const orderId = uuidv4();
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + TTL_SECONDS;

    const order: Order = {
      orderId,
      customerId: dto.customerId,
      idempotencyKey,
      status: 'PENDING',
      items: resolvedItems,
      subtotal,
      shippingCost,
      tax,
      total,
      currency: dto.currency,
      shippingAddress: dto.shippingAddress,
      paymentMethodId: dto.paymentMethodId,
      customerEmail,
      statusTimeline: [{ status: 'PENDING', at: now }],
      createdAt: now,
      updatedAt: now,
      ttl,
    };

    await this.orderRepository.create(order);

    const eventPayload: OrderCreatedPayload = {
      orderId,
      customerId: order.customerId,
      items: resolvedItems,
      subtotal,
      shippingCost,
      tax,
      total,
      currency: dto.currency,
      shippingAddress: dto.shippingAddress,
      paymentMethodId: dto.paymentMethodId,
      customerEmail,
    };

    await this.eventBridgeService.publishEvent(OrderEventType.OrderCreated, eventPayload);

    this.logger.log('Order created and event published', { orderId, total, currency: dto.currency });

    return { order: this.toResponseDto(order), alreadyExisted: false };
  }

  /**
   * Retrieves an order by its ID.
   */
  async getOrder(orderId: string): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw AppError.notFound(ErrorCode.ORDER_NOT_FOUND, `Order not found: ${orderId}`, {
        orderId,
      });
    }
    return this.toResponseDto(order);
  }

  private toResponseDto(order: Order): OrderResponseDto {
    return {
      orderId: order.orderId,
      customerId: order.customerId,
      status: order.status,
      items: order.items,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      tax: order.tax,
      total: order.total,
      currency: order.currency,
      shippingAddress: order.shippingAddress,
      invoiceUrl: order.invoiceUrl,
      shipment: order.shipment,
      statusTimeline: order.statusTimeline,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
