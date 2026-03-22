import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';

export class ChargeFlowStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── DynamoDB ────────────────────────────────────────────────────────────

    const ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: 'orders',
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    ordersTable.addGlobalSecondaryIndex({
      indexName: 'idempotencyKey-index',
      partitionKey: { name: 'idempotencyKey', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    ordersTable.addGlobalSecondaryIndex({
      indexName: 'customerId-index',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const idempotencyTable = new dynamodb.Table(this, 'ProcessedEventsTable', {
      tableName: 'processed-events',
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ─── S3 ──────────────────────────────────────────────────────────────────

    const invoicesBucket = new s3.Bucket(this, 'InvoicesBucket', {
      bucketName: `charge-flow-invoices-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [{ expiration: Duration.days(2555) }], // ~7 years for compliance
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ─── EventBridge ─────────────────────────────────────────────────────────

    const eventBus = new events.EventBus(this, 'OrderEventBus', {
      eventBusName: 'ecommerce-orders',
    });

    // ─── SQS queues (one per service) ────────────────────────────────────────

    const makeQueue = (name: string) => {
      const dlq = new sqs.Queue(this, `${name}Dlq`, {
        queueName: `${name}-dlq`,
        retentionPeriod: Duration.days(14),
        encryption: sqs.QueueEncryption.SQS_MANAGED,
      });

      const queue = new sqs.Queue(this, `${name}Queue`, {
        queueName: name,
        visibilityTimeout: Duration.seconds(60),
        retentionPeriod: Duration.days(4),
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
      });

      return { queue, dlq };
    };

    const { queue: orderQueue } = makeQueue('order-service-queue');
    const { queue: invoiceQueue } = makeQueue('invoice-service-queue');
    const { queue: billingQueue } = makeQueue('billing-service-queue');
    const { queue: shippingQueue } = makeQueue('shipping-service-queue');
    const { queue: notificationQueue } = makeQueue('notification-service-queue');

    // ─── EventBridge rules ───────────────────────────────────────────────────

    const makeRule = (eventType: string, queue: sqs.Queue) => {
      const rule = new events.Rule(this, `Route${eventType}Rule`, {
        eventBus,
        ruleName: `route-${eventType}`,
        eventPattern: {
          source: ['ecommerce.orders'],
          detailType: [eventType],
        },
      });
      rule.addTarget(new targets.SqsQueue(queue));
    };

    // order-service listens to all downstream events for status updates
    makeRule('OrderInvoiced', orderQueue);
    makeRule('OrderPaid', orderQueue);
    makeRule('OrderPaymentFailed', orderQueue);
    makeRule('OrderShipped', orderQueue);

    makeRule('OrderCreated', invoiceQueue);
    makeRule('OrderInvoiced', billingQueue);
    makeRule('OrderPaid', shippingQueue);

    // notification-service listens to all events
    ['OrderCreated', 'OrderInvoiced', 'OrderPaid', 'OrderPaymentFailed', 'OrderShipped'].forEach(
      (t) => makeRule(t, notificationQueue),
    );

    // ─── IAM task roles (least privilege, one per service) ───────────────────

    const taskRolePrincipal = new iam.ServicePrincipal('ecs-tasks.amazonaws.com');

    // order-service
    const orderTaskRole = new iam.Role(this, 'OrderTaskRole', {
      assumedBy: taskRolePrincipal,
      roleName: 'charge-flow-order-task-role',
    });
    ordersTable.grantReadWriteData(orderTaskRole);
    idempotencyTable.grantReadWriteData(orderTaskRole);
    eventBus.grantPutEventsTo(orderTaskRole);
    orderQueue.grantConsumeMessages(orderTaskRole);

    // invoice-service
    const invoiceTaskRole = new iam.Role(this, 'InvoiceTaskRole', {
      assumedBy: taskRolePrincipal,
      roleName: 'charge-flow-invoice-task-role',
    });
    invoicesBucket.grantPut(invoiceTaskRole, 'invoices/*');
    idempotencyTable.grantReadWriteData(invoiceTaskRole);
    eventBus.grantPutEventsTo(invoiceTaskRole);
    invoiceQueue.grantConsumeMessages(invoiceTaskRole);

    // billing-service
    const billingTaskRole = new iam.Role(this, 'BillingTaskRole', {
      assumedBy: taskRolePrincipal,
      roleName: 'charge-flow-billing-task-role',
    });
    idempotencyTable.grantReadWriteData(billingTaskRole);
    eventBus.grantPutEventsTo(billingTaskRole);
    billingQueue.grantConsumeMessages(billingTaskRole);
    // Stripe is external — no additional AWS permissions needed

    // shipping-service
    const shippingTaskRole = new iam.Role(this, 'ShippingTaskRole', {
      assumedBy: taskRolePrincipal,
      roleName: 'charge-flow-shipping-task-role',
    });
    idempotencyTable.grantReadWriteData(shippingTaskRole);
    eventBus.grantPutEventsTo(shippingTaskRole);
    shippingQueue.grantConsumeMessages(shippingTaskRole);

    // notification-service
    const notificationTaskRole = new iam.Role(this, 'NotificationTaskRole', {
      assumedBy: taskRolePrincipal,
      roleName: 'charge-flow-notification-task-role',
    });
    idempotencyTable.grantReadWriteData(notificationTaskRole);
    notificationQueue.grantConsumeMessages(notificationTaskRole);
    notificationTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: ['*'], // SES does not support resource-level ARNs
      }),
    );
  }
}
