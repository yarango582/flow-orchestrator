import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OrchestratorConfigService } from './config/orchestrator-config.service';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);

  // Get configuration service
  const configService = app.get(OrchestratorConfigService);

  // Configure global prefix
  app.setGlobalPrefix('api/v1');

  // Enable CORS
  app.enableCors();

  // Start server
  const port = configService.port;
  await app.listen(port);

  logger.log(`🚀 Orchestrator Service started on http://localhost:${port}`);
  logger.log(`🎯 Environment: ${configService.nodeEnv}`);
  logger.log(`📊 Metrics available on port: ${configService.metricsPort}`);
  logger.log(`🏥 Health checks on port: ${configService.healthCheckPort}`);
  logger.log(
    `🔧 Worker scaling: ${configService.minWorkers}-${configService.maxWorkers} workers`,
  );
  logger.log(
    `⚖️ Load balancing strategy: ${configService.loadBalanceStrategy}`,
  );
}

bootstrap();
