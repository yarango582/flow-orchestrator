import { Module } from '@nestjs/common';
import { QueueManagementService } from './queue-management.service';
import { ConfigModule } from '../config/config.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [ConfigModule, MessagingModule],
  providers: [QueueManagementService],
  exports: [QueueManagementService],
})
export class QueueModule {}
