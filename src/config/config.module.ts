import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { OrchestratorConfigService } from './orchestrator-config.service';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  providers: [OrchestratorConfigService],
  exports: [OrchestratorConfigService],
})
export class ConfigModule {}
