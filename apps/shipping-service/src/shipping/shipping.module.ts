import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ShippingService } from './shipping.service';
import { ShippingConsumer } from './shipping.consumer';
import { DhlService } from './dhl.service';

@Module({
  imports: [HttpModule],
  providers: [DhlService, ShippingService, ShippingConsumer],
})
export class ShippingModule {}
