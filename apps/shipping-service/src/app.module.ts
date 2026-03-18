import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AwsModule, awsConfig } from '@app/aws';
import { ShippingModule } from './shipping/shipping.module';
import { MockCarriersModule } from './mock-carriers/mock-carriers.module';
import configuration, { validationSchema } from './config/configuration';

const isProduction = process.env['NODE_ENV'] === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [awsConfig, configuration],
      validationSchema,
    }),
    AwsModule,
    ShippingModule,
    ...(isProduction ? [] : [MockCarriersModule]),
  ],
})
export class AppModule {}
