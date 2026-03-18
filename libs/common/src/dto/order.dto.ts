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
import { AddressDto } from './address.dto';

export class OrderItemDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsInt()
  @Min(1)
  readonly quantity!: number;
}

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  readonly customerId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  readonly items!: OrderItemDto[];

  @ValidateNested()
  @Type(() => AddressDto)
  readonly shippingAddress!: AddressDto;

  @IsString()
  @IsNotEmpty()
  readonly paymentMethodId!: string;

  @IsString()
  @IsNotEmpty()
  readonly currency!: string;
}

export class OrderResponseDto {
  readonly orderId!: string;
  readonly customerId!: string;
  readonly status!: string;
  readonly items!: OrderItemDto[];
  readonly subtotal!: number;
  readonly shippingCost!: number;
  readonly tax!: number;
  readonly total!: number;
  readonly currency!: string;
  readonly shippingAddress!: AddressDto;
  readonly invoiceUrl?: string;
  readonly shipment?: {
    carrier: string;
    trackingNumber: string;
    estimatedDelivery: string;
  };
  readonly statusTimeline!: Array<{ status: string; at: string }>;
  readonly createdAt!: string;
  readonly updatedAt!: string;
}
