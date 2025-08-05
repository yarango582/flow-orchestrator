import { Module } from '@nestjs/common';
import { OrchestrationService } from './orchestration.service';
import { DatabaseModule } from '../database/database.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [DatabaseModule, MessagingModule],
  providers: [OrchestrationService],
  exports: [OrchestrationService],
})
export class OrchestrationModule {}
