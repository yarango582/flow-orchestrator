import { Module } from '@nestjs/common';
import { WorkerManagementService } from './worker-management.service';
import { ConfigModule } from '../config/config.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [ConfigModule, MessagingModule],
  providers: [WorkerManagementService],
  exports: [WorkerManagementService],
})
export class WorkerModule {}
