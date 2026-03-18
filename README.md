# charge-flow — E-Commerce Order Processing Platform

A production-grade e-commerce backend built with **NestJS monorepo**, **AWS EventBridge + SQS** event-driven microservices, and **LocalStack** for local development.

---

## System Architecture

```
Customer
   │
   │  POST /v1/orders
   ▼
┌──────────────────┐   OrderCreated   ┌─────────────────────┐
│   order-service  │ ────────────────▶│  EventBridge Bus     │
│  (HTTP + SQS)    │                  │  (ecommerce-orders)  │
└──────────────────┘                  └──────────┬──────────┘
         ▲                                       │
         │  OrderInvoiced,                       │ routes via SQS rules
         │  OrderPaid,              ┌────────────┼────────────┬──────────────────┐
         │  OrderShipped,           │            │            │                  │
         │  OrderPaymentFailed      ▼            ▼            ▼                  ▼
         │                  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐
         └──────────────────│ invoice  │  │ billing  │  │ shipping │  │  notification    │
                            │ service  │  │ service  │  │ service  │  │  service         │
                            └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────────────┘
                                 │              │              │           (SES emails)
                              S3 PDF         Stripe        FedEx mock
```

### Event Flow

```
POST /v1/orders
   → [order-service] validate, calculate totals, persist, publish OrderCreated
   → [invoice-service] generate PDF, upload to S3, publish OrderInvoiced
   → [billing-service] charge Stripe, publish OrderPaid | OrderPaymentFailed
   → [shipping-service] call carrier API, publish OrderShipped
   → [notification-service] send SES email at every stage
   → [order-service] listens for status events, updates DynamoDB timeline
```

---

## REST API Design

### `POST /v1/orders`

**Request Headers:**
```
Content-Type: application/json
Idempotency-Key: <client-generated UUID>     # required — enables safe retries
```

**Request Body:**
```json
{
  "customerId": "cust-abc-123",
  "items": [
    { "productId": "PROD-001", "quantity": 2 },
    { "productId": "PROD-003", "quantity": 1 }
  ],
  "shippingAddress": {
    "line1": "123 Main Street",
    "line2": "Apt 4B",
    "city": "Springfield",
    "state": "IL",
    "postalCode": "62701",
    "countryCode": "US"
  },
  "paymentMethodId": "pm_1234567890",
  "currency": "USD"
}
```

**Response `201 Created`** (first request):
```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "customerId": "cust-abc-123",
  "status": "PENDING",
  "items": [
    { "productId": "PROD-001", "quantity": 2, "unitPrice": 2999, "name": "Widget Pro" },
    { "productId": "PROD-003", "quantity": 1, "unitPrice": 1299, "name": "Super Doohickey" }
  ],
  "subtotal": 7297,
  "shippingCost": 599,
  "tax": 584,
  "total": 8480,
  "currency": "USD",
  "shippingAddress": { ... },
  "statusTimeline": [
    { "status": "PENDING", "at": "2026-03-18T12:00:00.000Z" }
  ],
  "createdAt": "2026-03-18T12:00:00.000Z",
  "updatedAt": "2026-03-18T12:00:00.000Z"
}
```

**Response `202 Accepted`** (duplicate `Idempotency-Key`): same body, cached result.

**Error responses:**
```json
{ "error": { "code": "ORDER_INVALID_PRODUCT", "message": "Unknown product: PROD-999", "productId": "PROD-999" } }
{ "error": { "code": "ORDER_INVALID_CURRENCY", "message": "Unsupported currency: JPY" } }
{ "error": { "code": "VALIDATION_ERROR", "message": "Missing required header: Idempotency-Key" } }
```

### `GET /v1/orders/:id`

**Response `200 OK`:** Full order object (see above) — includes `invoiceUrl`, `shipment`, full `statusTimeline` as order progresses.

**Response `404 Not Found`:**
```json
{ "error": { "code": "ORDER_NOT_FOUND", "message": "Order not found: <id>" } }
```

---

## Project Structure

```
charge-flow/
├── docker-compose.yml
├── package.json                        # root — npm workspaces
├── tsconfig.base.json
├── nest-cli.json                       # monorepo config
│
├── libs/
│   ├── common/                         # shared DTOs, events, errors, filters
│   │   └── src/
│   │       ├── dto/
│   │       ├── events/order-events.ts  # typed event contracts
│   │       ├── errors/
│   │       └── filters/
│   └── aws/                            # EventBridge + SQS wrappers
│       └── src/
│
└── apps/
    ├── order-service/     port 3001
    ├── invoice-service/   port 3002
    ├── billing-service/   port 3003
    ├── shipping-service/  port 3004   (includes mock carrier endpoint)
    └── notification-service/ port 3005
```

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | NestJS 10 (native monorepo) |
| Language | TypeScript 5 — strict mode, no `any` |
| Database | DynamoDB (`@aws-sdk/lib-dynamodb`) |
| Event bus | AWS EventBridge → SQS (LocalStack locally) |
| Validation | `class-validator` + `class-transformer` + global `ValidationPipe` |
| Config | `@nestjs/config` + Joi schema validation (fail-fast) |
| PDF | `pdfkit` |
| Email | AWS SES |
| Payments | Stripe |
| Shipping | Mock FedEx NestJS controller |
| Testing | Jest + `@nestjs/testing` |
| Local AWS | LocalStack 3 via Docker Compose |

---

## Non-Functional Design Decisions

### Idempotency
Every `POST /v1/orders` requires an `Idempotency-Key` header. The key is stored in DynamoDB with a GSI. Duplicate requests return the cached `202 Accepted` response without re-processing — safe for client retries under network failures.

### Error Handling
- **HTTP layer**: Global `HttpExceptionFilter` catches `AppError` (domain errors) and `HttpException` (validation errors), returning `{ error: { code, message, ...meta } }`.
- **SQS consumers**: Handler errors are logged with full context but the message is **not deleted** — it becomes visible again after the visibility timeout and eventually routes to a DLQ (5 max receive count).
- **Payment failures**: Published as `OrderPaymentFailed` events (not thrown) so the notification service can email the customer and the order status is updated to `FAILED`.

### Observability
All services use structured JSON logging via NestJS `Logger`. Every log entry includes the `orderId` and relevant context. In production, these would be shipped to CloudWatch.

### Data Model
Orders are stored with a 90-day TTL. The `statusTimeline` array is append-only — each status transition is logged with a timestamp, providing a full audit trail.

### Scalability
- Each SQS queue has a DLQ (5 max receive count).
- Long-polling (20s wait time) minimises API calls.
- EventBridge rules route events to the correct service queue — adding a new service is a matter of creating a new rule.
- DynamoDB on-demand billing scales automatically.

---

## Running Locally

### Prerequisites
- Docker + Docker Compose
- Node.js 20+

### Start all services
```bash
docker compose up --build
```

### Smoke test
```bash
curl -X POST http://localhost:3001/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "customerId": "cust-demo-001",
    "items": [{"productId": "PROD-001", "quantity": 2}],
    "shippingAddress": {
      "line1": "123 Main St",
      "city": "Springfield",
      "state": "IL",
      "postalCode": "62701",
      "countryCode": "US"
    },
    "paymentMethodId": "pm_test_123",
    "currency": "USD"
  }'
```

### Run tests
```bash
npm install
npm test
```

### Build individual services
```bash
npm run build:order-service
npm run build:invoice-service
npm run build:billing-service
npm run build:shipping-service
npm run build:notification-service
```

---

## Product Catalog (hardcoded for demo)

| Product ID | Name | Price |
|---|---|---|
| PROD-001 | Widget Pro | $29.99 |
| PROD-002 | Gadget Plus | $49.99 |
| PROD-003 | Super Doohickey | $12.99 |
| PROD-004 | Thingamajig Elite | $89.99 |

Prices are verified **server-side** — client-supplied prices are ignored to prevent price manipulation.
