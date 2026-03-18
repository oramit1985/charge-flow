import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationConsumer } from './notification.consumer';

@Module({
  providers: [NotificationService, NotificationConsumer],
})
export class NotificationModule {}
