import { IsString, IsNotEmpty, IsISO31661Alpha2, IsOptional, Length } from 'class-validator';

export class AddressDto {
  @IsString()
  @IsNotEmpty()
  readonly line1!: string;

  @IsString()
  @IsOptional()
  readonly line2?: string;

  @IsString()
  @IsNotEmpty()
  readonly city!: string;

  @IsString()
  @IsNotEmpty()
  readonly state!: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 10)
  readonly postalCode!: string;

  @IsISO31661Alpha2()
  readonly countryCode!: string;
}
