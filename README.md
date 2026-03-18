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
                              S3 PDF         Stripe          DHL
```

### Event Flow

```
POST /v1/orders
   → [order-service] validate, calculate totals, persist, publish OrderCreated
   → [invoice-service] generate PDF, upload to S3, publish OrderInvoiced
   → [billing-service] charge Stripe, publish OrderPaid | OrderPaymentFailed
   → [shipping-service] call DHL Express API, publish OrderShipped
   → [notification-service] send SES email at every stage
   → [order-service] listens for status events, updates DynamoDB timeline
```

---

## Running Locally

### Prerequisites
- Docker + Docker Compose
- Node.js 20+

### Start everything
```bash
docker compose up --build
```

All services start automatically. No external credentials are needed — DHL calls are intercepted by a local mock carrier running inside the shipping-service container.

### Force a clean rebuild
```bash
docker compose build --no-cache && docker compose up
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

---

## REST API

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
  "shippingAddress": { "..." : "..." },
  "statusTimeline": [
    { "status": "PENDING", "at": "2026-03-18T12:00:00.000Z" }
  ],
  "createdAt": "2026-03-18T12:00:00.000Z",
  "updatedAt": "2026-03-18T12:00:00.000Z"
}
```

**Response `202 Accepted`** (duplicate `Idempotency-Key`): same body, cached result.

**Errors:**
```json
{ "error": { "code": "ORDER_INVALID_PRODUCT", "message": "Unknown product: PROD-999" } }
{ "error": { "code": "ORDER_INVALID_CURRENCY", "message": "Unsupported currency: JPY" } }
{ "error": { "code": "VALIDATION_ERROR", "message": "Missing required header: Idempotency-Key" } }
```

### `GET /v1/orders/:id`

Returns the full order object including `invoiceUrl`, `shipment`, and `statusTimeline` as the order progresses.

**`404 Not Found`:**
```json
{ "error": { "code": "ORDER_NOT_FOUND", "message": "Order not found: <id>" } }
```

---

## Environment Variables

All services share a base set of AWS variables. Each service has its own `.env` under `apps/<service>/.env`.

### Shared (all services)

| Variable | Description |
|---|---|
| `AWS_REGION` | AWS region (`us-east-1`) |
| `AWS_ACCESS_KEY_ID` | AWS key (`test` for LocalStack) |
| `AWS_SECRET_ACCESS_KEY` | AWS secret (`test` for LocalStack) |
| `AWS_ENDPOINT_URL` | Override endpoint — set to `http://localstack:4566` locally |
| `ORDER_EVENT_BUS_NAME` | EventBridge bus name (`ecommerce-orders`) |
| `SQS_QUEUE_NAME` | Each service's SQS queue name |

### Per-service

| Service | Variable | Description |
|---|---|---|
| order-service | `ORDERS_TABLE` | DynamoDB table name |
| order-service | `SES_FROM_EMAIL` | Sender address for SES emails |
| invoice-service | `S3_INVOICES_BUCKET` | S3 bucket for PDF invoices |
| billing-service | `STRIPE_SECRET_KEY` | Stripe secret key |
| notification-service | `SES_FROM_EMAIL` | Sender address for SES emails |

### shipping-service — DHL Express

| Variable | Dev default | Description |
|---|---|---|
| `DHL_BASE_URL` | `http://shipping-service:3000/mock-carrier` | DHL API base URL. In production: `https://express.api.dhl.com/mydhlapi` |
| `DHL_API_KEY` | `dev-placeholder` | DHL API key |
| `DHL_API_SECRET` | `dev-placeholder` | DHL API secret |
| `DHL_ACCOUNT_NUMBER` | `dev-placeholder` | DHL account number |
| `DHL_SHIPPER_NAME` | `Dev Shipper` | Your company name (appears on labels) |
| `DHL_SHIPPER_EMAIL` | `dev@example.com` | Shipper contact email |
| `DHL_SHIPPER_PHONE` | `+10000000000` | Shipper contact phone |
| `DHL_SHIPPER_ADDRESS_LINE1` | `1 Dev Street` | Shipper address |
| `DHL_SHIPPER_CITY` | `Dev City` | Shipper city |
| `DHL_SHIPPER_POSTAL_CODE` | `00000` | Shipper postal code |
| `DHL_SHIPPER_COUNTRY_CODE` | `US` | Shipper country (ISO 3166-1 alpha-2) |
| `DHL_DEFAULT_WEIGHT_KG` | `1` | Fallback package weight when item weights are unavailable |

#### Switching to real DHL in production
Get credentials at [developer.dhl.com](https://developer.dhl.com), then set:
```
DHL_BASE_URL=https://express.api.dhl.com/mydhlapi
DHL_API_KEY=<your key>
DHL_API_SECRET=<your secret>
DHL_ACCOUNT_NUMBER=<your account>
```

---

## Product Catalog (hardcoded for demo)

| Product ID | Name | Price |
|---|---|---|
| PROD-001 | Widget Pro | $29.99 |
| PROD-002 | Gadget Plus | $49.99 |
| PROD-003 | Super Doohickey | $12.99 |
| PROD-004 | Thingamajig Elite | $89.99 |

Prices are verified **server-side** — client-supplied prices are ignored.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | NestJS 10 (native monorepo) |
| Language | TypeScript 5 — strict mode |
| Database | DynamoDB (`@aws-sdk/lib-dynamodb`) |
| Event bus | AWS EventBridge → SQS (LocalStack locally) |
| Validation | `class-validator` + `class-transformer` + Joi schema validation |
| PDF | `pdfkit` |
| Email | AWS SES |
| Payments | Stripe |
| Shipping | DHL Express API (mock carrier in development) |
| Local AWS | LocalStack 3 via Docker Compose |

---

## Design Notes

**Idempotency** — Every `POST /v1/orders` requires an `Idempotency-Key` header stored in DynamoDB (GSI). Duplicates return `202 Accepted` with the cached response — safe for client retries.

**Error handling** — SQS consumer errors leave the message on the queue (not deleted), so it retries up to 5 times before routing to a DLQ. Payment failures are published as `OrderPaymentFailed` events rather than thrown, so the notification service can email the customer.

**Data model** — Orders have a 90-day TTL. `statusTimeline` is append-only, providing a full audit trail of every status transition with timestamps.

**Shipping mock** — In `development`/`test` environments, `MockCarriersModule` is loaded and `DHL_BASE_URL` points to it (`http://shipping-service:3000/mock-carrier`). The mock returns a DHL-compatible response. In `production`, `MockCarriersModule` is not loaded and the real DHL API is called.
