import { Module } from '@nestjs/common';
import { WorkerManagementService } from './worker-management.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [WorkerManagementService],
  exports: [WorkerManagementService],
})
export class WorkerModule {}
