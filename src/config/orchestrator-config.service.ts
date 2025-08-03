import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OrchestratorConfigService {
  constructor(private readonly configService: ConfigService) {}

  // Server Configuration
  get port(): number {
    return this.configService.get<number>('PORT', 3003);
  }

  get nodeEnv(): string {
    return this.configService.get<string>('NODE_ENV', 'development');
  }

  // RabbitMQ Configuration
  get rabbitmqUrl(): string {
    return this.configService.get<string>(
      'RABBITMQ_URL',
      'amqp://flow_user:flow_password@localhost:5672/flow_platform',
    );
  }

  get rabbitmqExchange(): string {
    return this.configService.get<string>(
      'RABBITMQ_EXCHANGE',
      'flow_orchestration',
    );
  }

  get rabbitmqPrefetch(): number {
    return this.configService.get<number>('RABBITMQ_PREFETCH', 50);
  }

  // Worker Management Configuration
  get workerHealthCheckInterval(): number {
    return this.configService.get<number>(
      'WORKER_HEALTH_CHECK_INTERVAL',
      30000,
    );
  }

  get workerTimeout(): number {
    return this.configService.get<number>('WORKER_TIMEOUT', 300000);
  }

  get minWorkers(): number {
    return this.configService.get<number>('MIN_WORKERS', 2);
  }

  get maxWorkers(): number {
    return this.configService.get<number>('MAX_WORKERS', 20);
  }

  get autoScalingEnabled(): boolean {
    return this.configService.get<boolean>('AUTO_SCALING_ENABLED', true);
  }

  // Load Balancing Configuration
  get loadBalanceStrategy(): 'round_robin' | 'least_busy' | 'weighted' {
    const strategy = this.configService.get<string>(
      'LOAD_BALANCE_STRATEGY',
      'round_robin',
    );
    if (!['round_robin', 'least_busy', 'weighted'].includes(strategy)) {
      return 'round_robin';
    }
    return strategy as 'round_robin' | 'least_busy' | 'weighted';
  }

  get queueHighWaterMark(): number {
    return this.configService.get<number>('QUEUE_HIGH_WATER_MARK', 1000);
  }

  get queueLowWaterMark(): number {
    return this.configService.get<number>('QUEUE_LOW_WATER_MARK', 100);
  }

  // Database Configuration
  get databaseUrl(): string {
    return this.configService.get<string>(
      'DATABASE_URL',
      'postgresql://flow_user:flow_password@localhost:5433/flow_platform',
    );
  }

  get databasePoolSize(): number {
    return this.configService.get<number>('DATABASE_POOL_SIZE', 10);
  }

  // Monitoring Configuration
  get metricsEnabled(): boolean {
    return this.configService.get<boolean>('METRICS_ENABLED', true);
  }

  get metricsPort(): number {
    return this.configService.get<number>('METRICS_PORT', 9091);
  }

  get healthCheckPort(): number {
    return this.configService.get<number>('HEALTH_CHECK_PORT', 8080);
  }

  get logLevel(): string {
    return this.configService.get<string>('LOG_LEVEL', 'info');
  }

  // Orchestrator specific config
  get orchestratorId(): string {
    return this.configService.get<string>(
      'ORCHESTRATOR_ID',
      `orchestrator-${process.env.HOSTNAME || 'local'}`,
    );
  }

  get taskProcessingConcurrency(): number {
    return this.configService.get<number>('TASK_PROCESSING_CONCURRENCY', 100);
  }

  get deadLetterQueueRetryAttempts(): number {
    return this.configService.get<number>('DLQ_RETRY_ATTEMPTS', 3);
  }

  get taskTimeoutMs(): number {
    return this.configService.get<number>('TASK_TIMEOUT_MS', 300000); // 5 minutes
  }
}
