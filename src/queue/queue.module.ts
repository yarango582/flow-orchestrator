import { Module } from '@nestjs/common';
import { QueueManagementService } from './queue-management.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [QueueManagementService],
  exports: [QueueManagementService],
})
export class QueueModule {}
