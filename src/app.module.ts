import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { MessagingModule } from './messaging/messaging.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { JobSchedulingModule } from './scheduling/job-scheduling.module';

@Module({
  imports: [
    ConfigModule,
    MessagingModule,
    OrchestratorModule,
    JobSchedulingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
