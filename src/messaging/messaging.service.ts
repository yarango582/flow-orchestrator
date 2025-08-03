import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  RabbitMQClient,
  RabbitMQConfig,
  TaskMessage,
  FlowExecutionMessage,
  ResultMessage,
  WorkerRegistrationMessage,
  WorkerHeartbeatMessage,
  Queues,
  TaskPriority,
} from 'flow-platform-node-core';
import { OrchestratorConfigService } from '../config/orchestrator-config.service';

@Injectable()
export class MessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private rabbitMQClient: RabbitMQClient;

  constructor(private readonly configService: OrchestratorConfigService) {}

  async onModuleInit() {
    try {
      const config: RabbitMQConfig = {
        url: this.configService.rabbitmqUrl,
        exchange: this.configService.rabbitmqExchange,
        prefetch: this.configService.rabbitmqPrefetch,
      };

      this.rabbitMQClient = new RabbitMQClient(config);
      await this.rabbitMQClient.connect();

      // Setup consumers for orchestrator-specific queues
      await this.setupConsumers();

      this.logger.log('RabbitMQ connection established successfully');
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.rabbitMQClient) {
      await this.rabbitMQClient.disconnect();
      this.logger.log('RabbitMQ connection closed');
    }
  }

  private async setupConsumers() {
    // Listen for flow execution requests from API Gateway
    await this.rabbitMQClient.consume(
      Queues.FLOWS_HIGH,
      this.handleFlowExecutionRequest.bind(this),
    );

    await this.rabbitMQClient.consume(
      Queues.FLOWS_NORMAL,
      this.handleFlowExecutionRequest.bind(this),
    );

    await this.rabbitMQClient.consume(
      Queues.FLOWS_LOW,
      this.handleFlowExecutionRequest.bind(this),
    );

    // Listen for task results from workers
    await this.rabbitMQClient.consume(
      Queues.WORKER_RESULTS,
      this.handleTaskResult.bind(this),
    );

    // Listen for worker heartbeats
    await this.rabbitMQClient.consume(
      Queues.WORKER_HEARTBEAT,
      this.handleWorkerHeartbeat.bind(this),
    );

    // Listen for worker registrations
    await this.rabbitMQClient.consume(
      Queues.WORKER_REGISTRATION,
      this.handleWorkerRegistration.bind(this),
    );

    this.logger.log('All consumers setup completed');
  }

  private async handleFlowExecutionRequest(message: FlowExecutionMessage) {
    this.logger.debug(`Received flow execution request: ${message.flowId}`);
    // This will be handled by the TaskQueueService
    // Emit event for TaskQueueService to process
  }

  private async handleTaskResult(message: ResultMessage) {
    this.logger.debug(`Received task result: ${message.taskId}`);
    // This will be handled by the TaskQueueService
  }

  private async handleWorkerHeartbeat(message: WorkerHeartbeatMessage) {
    this.logger.debug(`Received worker heartbeat: ${message.workerId}`);
    // This will be handled by the WorkerManagementService
  }

  private async handleWorkerRegistration(message: WorkerRegistrationMessage) {
    this.logger.log(`Received worker registration: ${message.workerId}`);
    // This will be handled by the WorkerManagementService
  }

  /**
   * Distribute a task to an available worker
   */
  async distributeTask(
    task: TaskMessage,
    priority: TaskPriority = 'normal',
  ): Promise<void> {
    try {
      await this.rabbitMQClient.publishTask(task, priority);
      this.logger.debug(
        `Task distributed: ${task.id} with priority ${priority}`,
      );
    } catch (error) {
      this.logger.error(`Failed to distribute task ${task.id}:`, error);
      throw error;
    }
  }

  /**
   * Send result back to API Gateway
   */
  async sendResult(result: ResultMessage): Promise<void> {
    try {
      await this.rabbitMQClient.publishResult(result);
      this.logger.debug(`Result sent: ${result.taskId}`);
    } catch (error) {
      this.logger.error(`Failed to send result ${result.taskId}:`, error);
      throw error;
    }
  }

  /**
   * Get RabbitMQ client for advanced operations
   */
  getClient(): RabbitMQClient {
    return this.rabbitMQClient;
  }

  /**
   * Check if messaging service is connected
   */
  isConnected(): boolean {
    return this.rabbitMQClient?.isConnected() ?? false;
  }
}
