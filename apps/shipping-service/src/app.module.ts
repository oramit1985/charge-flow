import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AwsModule, awsConfig } from '@app/aws';
import { ShippingModule } from './shipping/shipping.module';
import { MockCarriersModule } from './mock-carriers/mock-carriers.module';
import configuration, { validationSchema } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [awsConfig, configuration],
      validationSchema,
    }),
    AwsModule,
    ShippingModule,
    MockCarriersModule,
  ],
})
export class AppModule {}
