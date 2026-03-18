import { Module } from '@nestjs/common';
import { MockCarriersController } from './mock-carriers.controller';

@Module({
  controllers: [MockCarriersController],
})
export class MockCarriersModule {}
