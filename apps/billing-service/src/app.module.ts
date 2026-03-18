import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AwsModule, awsConfig } from '@app/aws';
import { BillingModule } from './billing/billing.module';
import configuration, { validationSchema } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [awsConfig, configuration],
      validationSchema,
    }),
    AwsModule,
    BillingModule,
  ],
})
export class AppModule {}
