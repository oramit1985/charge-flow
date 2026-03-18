import { IsString, IsNotEmpty, IsISO31661Alpha2, IsOptional, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddressDto {
  @ApiProperty({ example: '123 Main Street' })
  @IsString()
  @IsNotEmpty()
  readonly line1!: string;

  @ApiPropertyOptional({ example: 'Apt 4B' })
  @IsString()
  @IsOptional()
  readonly line2?: string;

  @ApiProperty({ example: 'Springfield' })
  @IsString()
  @IsNotEmpty()
  readonly city!: string;

  @ApiProperty({ example: 'IL' })
  @IsString()
  @IsNotEmpty()
  readonly state!: string;

  @ApiProperty({ example: '62701', minLength: 4, maxLength: 10 })
  @IsString()
  @IsNotEmpty()
  @Length(4, 10)
  readonly postalCode!: string;

  @ApiProperty({ example: 'US', description: 'ISO 3166-1 alpha-2 country code' })
  @IsISO31661Alpha2()
  readonly countryCode!: string;
}
