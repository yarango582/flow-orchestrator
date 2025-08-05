import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { MessagingModule } from './messaging/messaging.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { JobSchedulingModule } from './scheduling/job-scheduling.module';
import { FlowsModule } from './flows/flows.module';
import { DatabaseModule } from './database/database.module';
import { ExecutionsModule } from './executions/executions.module';
import { OrchestrationModule } from './orchestration/orchestration.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MessagingModule,
    OrchestrationModule,
    OrchestratorModule,
    JobSchedulingModule,
    FlowsModule,
    ExecutionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
