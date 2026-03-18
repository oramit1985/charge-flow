import { Module } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { InvoiceConsumer } from './invoice.consumer';

@Module({
  providers: [InvoiceService, InvoiceConsumer],
})
export class InvoiceModule {}
