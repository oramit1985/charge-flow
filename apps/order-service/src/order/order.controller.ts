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
import { Response } from 'express';
import { OrderService, IDEMPOTENCY_KEY_HEADER } from './order.service';
import { CreateOrderDto } from '@app/common/dto/order.dto';
import { AppError } from '@app/common/errors/app.error';
import { ErrorCode } from '@app/common/errors/error-codes.enum';

/**
 * Handles HTTP requests for the order resource.
 * Contains zero business logic — delegates entirely to OrderService.
 */
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
  async getOrder(@Param('id') id: string) {
    return this.orderService.getOrder(id);
  }
}
