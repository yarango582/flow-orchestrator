import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { ExecutionService } from './execution.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [DatabaseService, ExecutionService],
  exports: [DatabaseService, ExecutionService],
})
export class DatabaseModule {}
