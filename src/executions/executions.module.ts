import { Module } from '@nestjs/common';
import { ExecutionsController } from './executions.controller';
import { DatabaseModule } from '../database/database.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';

@Module({
  imports: [DatabaseModule, OrchestrationModule],
  controllers: [ExecutionsController],
  exports: [],
})
export class ExecutionsModule {}
