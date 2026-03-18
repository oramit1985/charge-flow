import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AwsModule, awsConfig } from '@app/aws';
import { InvoiceModule } from './invoice/invoice.module';
import configuration, { validationSchema } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [awsConfig, configuration],
      validationSchema,
    }),
    AwsModule,
    InvoiceModule,
  ],
})
export class AppModule {}
