import { Injectable, Logger } from '@nestjs/common';
import {
  RabbitMQClient,
  TaskMessage,
  ResultMessage,
  FlowExecutionMessage,
} from 'flow-platform-node-core';
import { OrchestratorConfigService } from '../config/orchestrator-config.service';

export interface QueueInfo {
  name: string;
  messageCount: number;
  consumerCount: number;
  priority: 'high' | 'normal' | 'low';
}

export interface TaskDistributionStrategy {
  distribute(task: TaskMessage, availableWorkers: string[]): string;
}

@Injectable()
export class QueueManagementService {
  private readonly logger = new Logger(QueueManagementService.name);
  private readonly rabbitMQClient: RabbitMQClient;
  private readonly queueNames = {
    high: 'tasks.high',
    normal: 'tasks.normal',
    low: 'tasks.low',
    results: 'results',
    dlq: 'tasks.dlq',
  };

  constructor(private readonly config: OrchestratorConfigService) {
    this.rabbitMQClient = new RabbitMQClient({
      url: this.config.rabbitmqUrl,
      exchange: this.config.rabbitmqExchange,
      prefetch: this.config.rabbitmqPrefetch,
    });
  }

  async onModuleInit() {
    await this.initializeQueues();
    await this.startQueueMonitoring();
  }

  private async initializeQueues() {
    try {
      await this.rabbitMQClient.connect();
      this.logger.log('RabbitMQ connected for queue management');

      // Setup consumers for different priority queues
      await this.setupTaskConsumers();
      await this.setupResultConsumer();

      this.logger.log('All queue consumers initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize queues', error);
      throw error;
    }
  }

  private async setupTaskConsumers() {
    // High priority tasks
    await this.rabbitMQClient.consume(this.queueNames.high, async (message) => {
      await this.handleTaskMessage(message as TaskMessage, 'high');
    });

    // Normal priority tasks
    await this.rabbitMQClient.consume(
      this.queueNames.normal,
      async (message) => {
        await this.handleTaskMessage(message as TaskMessage, 'normal');
      },
    );

    // Low priority tasks
    await this.rabbitMQClient.consume(this.queueNames.low, async (message) => {
      await this.handleTaskMessage(message as TaskMessage, 'low');
    });
  }

  private async setupResultConsumer() {
    await this.rabbitMQClient.consume(
      this.queueNames.results,
      async (message) => {
        await this.handleResultMessage(message as ResultMessage);
      },
    );
  }

  private async handleTaskMessage(
    task: TaskMessage,
    priority: 'high' | 'normal' | 'low',
  ) {
    try {
      this.logger.log(`Processing ${priority} priority task: ${task.id}`);

      // La lógica de distribución se manejará en el worker-management.service
      // Aquí solo registramos que la tarea fue recibida
      this.logger.log(
        `Task ${task.id} received and ready for worker assignment`,
      );
    } catch (error) {
      this.logger.error(`Failed to process task ${task.id}`, error);
      await this.sendToDeadLetterQueue(task, error.message);
    }
  }

  private async handleResultMessage(result: ResultMessage) {
    try {
      this.logger.log(`Result received for task: ${result.taskId}`);

      // Procesar resultado y actualizar estado en base de datos
      // Notificar al API Gateway si es necesario

      this.logger.log(
        `Result processed successfully for task: ${result.taskId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process result for task ${result.taskId}`,
        error,
      );
    }
  }

  async publishFlowExecution(
    flowExecution: FlowExecutionMessage,
    priority: 'high' | 'normal' | 'low' = 'normal',
  ) {
    try {
      const queueName = this.queueNames[priority];

      // Convert FlowExecutionMessage to TaskMessage format
      const task: TaskMessage = {
        id: `flow-${flowExecution.executionId}`,
        timestamp: new Date().toISOString(),
        version: '1.0',
        flowId: flowExecution.flowId,
        nodeId: 'flow-start',
        nodeType: 'flow_execution',
        priority: priority,
        configuration: {},
        inputs: flowExecution.inputs || {},
        metadata: {
          createdAt: new Date().toISOString(),
          flowName: `Flow ${flowExecution.flowId}`,
          nodeIndex: 0,
          totalNodes: 1,
        },
        retry: {
          attempts: 0,
          maxAttempts: 3,
          backoffMs: 1000,
        },
        timeout: {
          executionTimeoutMs: 300000,
          queueTimeoutMs: 60000,
        },
      };

      await this.rabbitMQClient.publishTask(task);

      this.logger.log(
        `Flow execution task published: ${task.id} to ${queueName}`,
      );
      return task.id;
    } catch (error) {
      this.logger.error('Failed to publish flow execution', error);
      throw error;
    }
  }

  async publishTask(
    task: TaskMessage,
    priority: 'high' | 'normal' | 'low' = 'normal',
  ) {
    try {
      await this.rabbitMQClient.publishTask(task);

      this.logger.log(`Task published: ${task.id} to ${priority} queue`);
    } catch (error) {
      this.logger.error(`Failed to publish task ${task.id}`, error);
      throw error;
    }
  }

  private async sendToDeadLetterQueue(task: TaskMessage, errorMessage: string) {
    try {
      const dlqTask = {
        ...task,
        error: errorMessage,
        failedAt: new Date().toISOString(),
        retry: {
          ...task.retry,
          attempts: task.retry.attempts + 1,
        },
      };

      await this.rabbitMQClient.publish(
        this.config.rabbitmqExchange,
        this.queueNames.dlq,
        dlqTask,
        { persistent: true },
      );
      this.logger.warn(`Task ${task.id} sent to dead letter queue`);
    } catch (error) {
      this.logger.error(`Failed to send task ${task.id} to DLQ`, error);
    }
  }

  async getQueueStats(): Promise<QueueInfo[]> {
    // Esta implementación sería específica si RabbitMQClient tuviera métodos de estadísticas
    // Por ahora retornamos un mock básico
    return [
      {
        name: this.queueNames.high,
        messageCount: 0,
        consumerCount: 1,
        priority: 'high',
      },
      {
        name: this.queueNames.normal,
        messageCount: 0,
        consumerCount: 1,
        priority: 'normal',
      },
      {
        name: this.queueNames.low,
        messageCount: 0,
        consumerCount: 1,
        priority: 'low',
      },
    ];
  }

  private async startQueueMonitoring() {
    setInterval(async () => {
      try {
        const stats = await this.getQueueStats();

        for (const stat of stats) {
          if (stat.messageCount > this.config.queueHighWaterMark) {
            this.logger.warn(
              `Queue ${stat.name} has high message count: ${stat.messageCount}`,
            );
            // Trigger scaling logic here
          }
        }
      } catch (error) {
        this.logger.error('Queue monitoring failed', error);
      }
    }, 30000); // Check every 30 seconds
  }

  async onModuleDestroy() {
    try {
      await this.rabbitMQClient.disconnect();
      this.logger.log('RabbitMQ client disconnected');
    } catch (error) {
      this.logger.error('Error disconnecting RabbitMQ client', error);
    }
  }
}
