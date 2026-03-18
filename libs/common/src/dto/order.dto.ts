import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AddressDto } from './address.dto';

export class OrderItemDto {
  @ApiProperty({ example: 'PROD-001', description: 'Must exist in the product catalog' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  readonly quantity!: number;
}

export class CreateOrderDto {
  @ApiProperty({ example: 'cust-abc-123' })
  @IsString()
  @IsNotEmpty()
  readonly customerId!: string;

  @ApiProperty({ type: [OrderItemDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  readonly items!: OrderItemDto[];

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  readonly shippingAddress!: AddressDto;

  @ApiProperty({ example: 'pm_1234567890', description: 'Stripe PaymentMethod ID' })
  @IsString()
  @IsNotEmpty()
  readonly paymentMethodId!: string;

  @ApiProperty({ example: 'USD', description: 'ISO 4217 currency code' })
  @IsString()
  @IsNotEmpty()
  readonly currency!: string;
}

class OrderItemResponseDto {
  @ApiProperty({ example: 'PROD-001' })
  readonly productId!: string;

  @ApiProperty({ example: 2 })
  readonly quantity!: number;

  @ApiProperty({ example: 2999, description: 'Unit price in cents — always server-verified' })
  readonly unitPrice!: number;

  @ApiProperty({ example: 'Widget Pro' })
  readonly name!: string;
}

class StatusTimelineEntryDto {
  @ApiProperty({ example: 'PENDING' })
  readonly status!: string;

  @ApiProperty({ example: '2026-03-18T12:00:00.000Z' })
  readonly at!: string;
}

class ShipmentDto {
  @ApiProperty({ example: 'DHL' })
  readonly carrier!: string;

  @ApiProperty({ example: '1234567890' })
  readonly trackingNumber!: string;

  @ApiProperty({ example: '2026-03-21' })
  readonly estimatedDelivery!: string;
}

export class OrderResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  readonly orderId!: string;

  @ApiProperty({ example: 'cust-abc-123' })
  readonly customerId!: string;

  @ApiProperty({ example: 'PENDING', enum: ['PENDING', 'INVOICED', 'PAID', 'SHIPPED', 'FAILED'] })
  readonly status!: string;

  @ApiProperty({ type: [OrderItemResponseDto] })
  readonly items!: OrderItemResponseDto[];

  @ApiProperty({ example: 5998, description: 'Sum of all items in cents' })
  readonly subtotal!: number;

  @ApiProperty({ example: 599, description: 'Flat shipping fee in cents' })
  readonly shippingCost!: number;

  @ApiProperty({ example: 479, description: 'Calculated tax in cents' })
  readonly tax!: number;

  @ApiProperty({ example: 7076, description: 'Total charge in cents (subtotal + shipping + tax)' })
  readonly total!: number;

  @ApiProperty({ example: 'USD' })
  readonly currency!: string;

  @ApiProperty({ type: AddressDto })
  readonly shippingAddress!: AddressDto;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/invoices/order-id/invoice.pdf' })
  readonly invoiceUrl?: string;

  @ApiPropertyOptional({ type: ShipmentDto })
  readonly shipment?: ShipmentDto;

  @ApiProperty({ type: [StatusTimelineEntryDto] })
  readonly statusTimeline!: StatusTimelineEntryDto[];

  @ApiProperty({ example: '2026-03-18T12:00:00.000Z' })
  readonly createdAt!: string;

  @ApiProperty({ example: '2026-03-18T12:00:00.000Z' })
  readonly updatedAt!: string;
}
