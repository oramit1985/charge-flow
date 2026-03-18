# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build a specific service
npm run build:<service-name>        # e.g. npm run build:order-service

# Run locally (single service, outside Docker)
npm run start:<service-name>        # e.g. npm run start:order-service
npm run start:dev:order-service     # watch mode (only order-service has this configured)

# Lint & format
npm run lint                        # eslint with --fix
npm run format                      # prettier

# Tests
npm test                            # all tests
npm run test:watch
npm run test:cov

# Run a specific test file
npx jest apps/order-service/src/order/order.service.spec.ts

# Full local stack
docker compose up --build           # builds all images and starts LocalStack + all 5 services
docker compose build --no-cache     # force full rebuild (needed after changing nest-cli.json or tsconfigs)
```

## Architecture

**NestJS monorepo** with npm workspaces. Five microservices under `apps/`, two shared libraries under `libs/`.

### Event flow (end-to-end)
```
POST /v1/orders → order-service
  → publishes OrderCreated to EventBridge (bus: ecommerce-orders)
  → invoice-service receives via SQS, generates PDF → S3, publishes OrderInvoiced
  → billing-service receives, charges Stripe, publishes OrderPaid or OrderPaymentFailed
  → shipping-service receives OrderPaid, calls mock carrier, publishes OrderShipped
  → notification-service receives ALL events, sends SES emails
  → order-service also receives all downstream events and updates DynamoDB order status
```

### Shared libraries
- **`@app/aws`** — `EventBridgeService` (publish/rule creation), `SqsService` (queue management + long-polling), `awsConfig` (typed config token), `awsValidationSchema` (Joi schema). Declared `@Global()`.
- **`@app/common`** — typed event envelopes/payloads (`@app/common/common-types`), DTOs, `AppError`, `HttpExceptionFilter`.

### AWS config pattern
All AWS credentials and shared config live in `libs/aws/src/aws.config.ts` via NestJS `registerAs('aws', ...)`. Services inject it as:
```typescript
@Inject(awsConfig.KEY) private readonly aws: ConfigType<typeof awsConfig>
```
Each app's `configuration.ts` extends `awsValidationSchema` for Joi validation and loads `awsConfig` in `ConfigModule.forRoot({ load: [awsConfig, configuration] })`.

### Consumer pattern
Each service has a `*Consumer` that on `onModuleInit`:
1. Calls `sqsService.ensureQueue(SQS_QUEUE_NAME)` — creates queue + DLQ if absent
2. Calls `eventBridgeService.createRule(eventType, { queueArn })` — idempotent EventBridge routing
3. Calls `sqsService.startPolling(queueUrl, handler)` — 20s long-poll loop

The queue name comes from `SQS_QUEUE_NAME` env var (set per-service in `.env` and `docker-compose.yml`).

### Infrastructure bootstrap
Services auto-create their AWS resources on startup (idempotent): S3 bucket, SQS queues+DLQs, EventBridge bus and rules, DynamoDB table. This keeps LocalStack zero-config.

### TypeScript / build
- `tsconfig.base.json` at root defines path aliases (`@app/aws`, `@app/common`) with `baseUrl: "./"`.
- Each service `tsconfig.app.json` sets `"baseUrl": "../.."` (monorepo root) so aliases resolve correctly.
- `nest-cli.json` uses `"webpack": true` — each service builds to a single `dist/apps/<service>/main.js`, which is what the Dockerfiles expect.
- Docker images copy `dist/apps/<service>` → `/app/dist`, then run `node dist/main`.

### Key env vars per service
All services share: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL`, `ORDER_EVENT_BUS_NAME`, `SQS_QUEUE_NAME`.
Service-specific: `ORDERS_TABLE` + `SES_FROM_EMAIL` (order), `S3_INVOICES_BUCKET` (invoice), `STRIPE_SECRET_KEY` (billing), `MOCK_CARRIER_BASE_URL` (shipping), `SES_FROM_EMAIL` (notification).
