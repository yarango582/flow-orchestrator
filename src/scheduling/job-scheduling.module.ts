import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JobSchedulingService } from './job-scheduling.service';
import { JobSchedulingController } from './job-scheduling.controller';
import { QueueModule } from '../queue/queue.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ScheduleModule.forRoot(), QueueModule, ConfigModule],
  controllers: [JobSchedulingController],
  providers: [JobSchedulingService],
  exports: [JobSchedulingService],
})
export class JobSchedulingModule {}
