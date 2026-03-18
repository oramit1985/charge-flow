import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { Response } from 'express';
import { OrderService, IDEMPOTENCY_KEY_HEADER } from './order.service';
import { CreateOrderDto, OrderResponseDto } from '@app/common/dto/order.dto';
import { AppError } from '@app/common/errors/app.error';
import { ErrorCode } from '@app/common/common-types/enums/error-codes';

@ApiTags('Orders')
@Controller('v1/orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  /**
   * POST /v1/orders
   *
   * Creates a new order from the provided shopping cart.
   * Requires the `Idempotency-Key` header for safe retries.
   *
   * Returns 201 Created on first call.
   * Returns 202 Accepted on duplicate (same Idempotency-Key).
   */
  @Post()
  @ApiOperation({
    summary: 'Create an order',
    description:
      'Validates the cart against the server-side product catalog, calculates totals, ' +
      'persists the order to DynamoDB, and triggers the fulfillment pipeline via EventBridge. ' +
      'Prices are always verified server-side — client-supplied prices are ignored.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Client-generated UUID. Duplicate requests with the same key return 202 with the cached response.',
    required: true,
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiBody({ type: CreateOrderDto })
  @ApiResponse({ status: 201, description: 'Order created successfully.', type: OrderResponseDto })
  @ApiResponse({ status: 202, description: 'Duplicate request — cached order returned.', type: OrderResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error, unknown product, or unsupported currency.' })
  async createOrder(
    @Body() dto: CreateOrderDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!idempotencyKey) {
      throw AppError.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'Missing required header: Idempotency-Key',
      );
    }

    // In production, customerEmail would come from the JWT/auth context.
    // For this demo we derive a placeholder from customerId.
    const customerEmail = `${dto.customerId}@example.com`;

    const { order, alreadyExisted } = await this.orderService.createOrder(
      dto,
      idempotencyKey,
      customerEmail,
    );

    const status = alreadyExisted ? HttpStatus.ACCEPTED : HttpStatus.CREATED;
    res.status(status).json(order);
  }

  /**
   * GET /v1/orders/:id
   *
   * Retrieves a single order by its ID.
   * Returns 200 OK with the order, or 404 if not found.
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get an order by ID',
    description:
      'Returns the full order including current status, invoice URL (once generated), ' +
      'shipment tracking details (once shipped), and a complete status timeline.',
  })
  @ApiParam({ name: 'id', description: 'Order UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({ status: 200, description: 'Order found.', type: OrderResponseDto })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async getOrder(@Param('id') id: string) {
    return this.orderService.getOrder(id);
  }
}
