import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { OrchestratorController } from './orchestrator.controller';
import { QueueModule } from '../queue/queue.module';
import { WorkerModule } from '../worker/worker.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule, QueueModule, WorkerModule],
  controllers: [OrchestratorController],
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
