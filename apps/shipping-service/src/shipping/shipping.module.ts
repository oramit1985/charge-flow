import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ShippingService } from './shipping.service';
import { ShippingConsumer } from './shipping.consumer';

@Module({
  imports: [HttpModule],
  providers: [ShippingService, ShippingConsumer],
})
export class ShippingModule {}
