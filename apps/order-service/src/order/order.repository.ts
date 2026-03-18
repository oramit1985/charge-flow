import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import {
  DynamoDBClient,
  CreateTableCommand,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { awsConfig } from '@app/aws';

export type OrderStatus = 'PENDING' | 'INVOICED' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'FAILED';

export interface OrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  name: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
}

export interface Shipment {
  carrier: string;
  trackingNumber: string;
  estimatedDelivery: string;
}

export interface StatusTimelineEntry {
  status: string;
  at: string;
}

export interface Order {
  orderId: string;
  customerId: string;
  idempotencyKey: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  shippingCost: number;
  tax: number;
  total: number;
  currency: string;
  shippingAddress: Address;
  paymentMethodId: string;
  customerEmail: string;
  invoiceUrl?: string;
  shipment?: Shipment;
  statusTimeline: StatusTimelineEntry[];
  createdAt: string;
  updatedAt: string;
  ttl: number;
}

@Injectable()
export class OrderRepository {
  private readonly logger = new Logger(OrderRepository.name);
  private readonly rawClient: DynamoDBClient;
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(
    @Inject(awsConfig.KEY) aws: ConfigType<typeof awsConfig>,
    private readonly configService: ConfigService,
  ) {
    this.rawClient = new DynamoDBClient({
      region: aws.region,
      credentials: {
        accessKeyId: aws.accessKeyId,
        secretAccessKey: aws.secretAccessKey,
      },
      ...(aws.endpointUrl ? { endpoint: aws.endpointUrl } : {}),
    });
    this.docClient = DynamoDBDocumentClient.from(this.rawClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.tableName = this.configService.getOrThrow<string>('ORDERS_TABLE');
  }

  /**
   * Ensures the orders DynamoDB table exists with required GSIs.
   */
  async ensureTableExists(): Promise<void> {
    try {
      await this.rawClient.send(
        new CreateTableCommand({
          TableName: this.tableName,
          KeySchema: [{ AttributeName: 'orderId', KeyType: 'HASH' }],
          AttributeDefinitions: [
            { AttributeName: 'orderId', AttributeType: 'S' },
            { AttributeName: 'idempotencyKey', AttributeType: 'S' },
            { AttributeName: 'customerId', AttributeType: 'S' },
          ],
          BillingMode: 'PAY_PER_REQUEST',
          GlobalSecondaryIndexes: [
            {
              IndexName: 'idempotencyKey-index',
              KeySchema: [{ AttributeName: 'idempotencyKey', KeyType: 'HASH' }],
              Projection: { ProjectionType: 'ALL' },
            },
            {
              IndexName: 'customerId-index',
              KeySchema: [{ AttributeName: 'customerId', KeyType: 'HASH' }],
              Projection: { ProjectionType: 'ALL' },
            },
          ],
        }),
      );
      this.logger.log(`DynamoDB table created: ${this.tableName}`);
    } catch (error: unknown) {
      if (error instanceof ResourceInUseException) {
        this.logger.log(`DynamoDB table already exists: ${this.tableName}`);
      } else {
        this.logger.error('Failed to ensure DynamoDB table exists', { error });
        throw error;
      }
    }
  }

  /**
   * Persists a new order to DynamoDB.
   */
  async create(order: Order): Promise<Order> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: order,
        ConditionExpression: 'attribute_not_exists(orderId)',
      }),
    );
    this.logger.log('Order created', { orderId: order.orderId });
    return order;
  }

  /**
   * Retrieves an order by its primary key.
   */
  async findById(orderId: string): Promise<Order | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { orderId },
      }),
    );
    return (result.Item as Order) ?? null;
  }

  /**
   * Retrieves an order by idempotency key via GSI.
   */
  async findByIdempotencyKey(idempotencyKey: string): Promise<Order | null> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'idempotencyKey-index',
        KeyConditionExpression: 'idempotencyKey = :key',
        ExpressionAttributeValues: { ':key': idempotencyKey },
        Limit: 1,
      }),
    );
    const items = result.Items as Order[] | undefined;
    return items?.[0] ?? null;
  }

  /**
   * Updates the order status, appending a timeline entry, and optionally sets
   * invoiceUrl or shipment details.
   */
  async updateStatus(
    orderId: string,
    status: OrderStatus,
    extra?: Partial<Pick<Order, 'invoiceUrl' | 'shipment'>>,
  ): Promise<void> {
    const now = new Date().toISOString();
    const timelineEntry: StatusTimelineEntry = { status, at: now };

    let updateExpression =
      'SET #status = :status, updatedAt = :updatedAt, statusTimeline = list_append(statusTimeline, :entry)';
    const expressionNames: Record<string, string> = { '#status': 'status' };
    const expressionValues: Record<string, unknown> = {
      ':status': status,
      ':updatedAt': now,
      ':entry': [timelineEntry],
    };

    if (extra?.invoiceUrl) {
      updateExpression += ', invoiceUrl = :invoiceUrl';
      expressionValues[':invoiceUrl'] = extra.invoiceUrl;
    }
    if (extra?.shipment) {
      updateExpression += ', shipment = :shipment';
      expressionValues[':shipment'] = extra.shipment;
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { orderId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
      }),
    );
    this.logger.log('Order status updated', { orderId, status });
  }
}
