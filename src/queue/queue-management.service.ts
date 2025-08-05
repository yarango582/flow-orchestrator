import { Injectable, Logger } from '@nestjs/common';
import {
  RabbitMQClient,
  TaskMessage,
  ResultMessage,
  FlowExecutionMessage,
  Queues,
  MessageFactory,
} from 'flow-platform-node-core';
import { OrchestratorConfigService } from '../config/orchestrator-config.service';
import { MessagingService } from '../messaging/messaging.service';

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
  private readonly queueNames = {
    high: Queues.TASKS_HIGH,
    normal: Queues.TASKS_NORMAL,
    low: Queues.TASKS_LOW,
    results: Queues.WORKER_RESULTS,
    dlq: Queues.DEAD_LETTER,
  };

  constructor(
    private readonly config: OrchestratorConfigService,
    private readonly messagingService: MessagingService,
  ) {}

  async onModuleInit() {
    await this.initializeQueues();
    await this.startQueueMonitoring();
  }

  private async initializeQueues() {
    try {
      // MessagingService handles the connection, we just setup consumers
      await this.setupTaskConsumers();
      await this.setupResultConsumer();

      this.logger.log('All queue consumers initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize queues', error);
      throw error;
    }
  }

  private async setupTaskConsumers() {
    const rabbitClient = this.messagingService.getClient();
    
    // High priority tasks
    await rabbitClient.consume(this.queueNames.high, async (message) => {
      await this.handleTaskMessage(message as TaskMessage, 'high');
    });

    // Normal priority tasks
    await rabbitClient.consume(
      this.queueNames.normal,
      async (message) => {
        await this.handleTaskMessage(message as TaskMessage, 'normal');
      },
    );

    // Low priority tasks
    await rabbitClient.consume(this.queueNames.low, async (message) => {
      await this.handleTaskMessage(message as TaskMessage, 'low');
    });
  }

  private async setupResultConsumer() {
    const rabbitClient = this.messagingService.getClient();
    
    await rabbitClient.consume(
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
  ): Promise<string[]> {
    try {
      this.logger.log(
        `Processing flow execution: ${flowExecution.flowId} with ${flowExecution.flowData.nodes.length} nodes`,
      );

      const taskIds: string[] = [];
      const totalNodes = flowExecution.flowData.nodes.length;

      // Create individual task messages for each node in the flow
      for (let i = 0; i < flowExecution.flowData.nodes.length; i++) {
        const node = flowExecution.flowData.nodes[i];
        
        // Create a proper task message using MessageFactory
        const task = MessageFactory.createTaskMessage({
          flowId: flowExecution.flowId,
          nodeId: node.id,
          nodeType: node.type,
          priority,
          configuration: node.config,
          inputs: flowExecution.inputs || {},
          userId: flowExecution.metadata.userId,
          flowName: flowExecution.flowData.name,
          nodeIndex: i,
          totalNodes,
          maxAttempts: 3,
          executionTimeoutMs: 300000,
        });

        // Distribute task to appropriate worker
        await this.messagingService.distributeTask(task, priority);
        taskIds.push(task.id);

        this.logger.debug(
          `Task created for node ${node.id} (${node.type}): ${task.id}`,
        );
      }

      this.logger.log(
        `Flow execution distributed: ${flowExecution.executionId} created ${taskIds.length} tasks`,
      );
      
      return taskIds;
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
      await this.messagingService.distributeTask(task, priority);

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

      const rabbitClient = this.messagingService.getClient();
      await rabbitClient.publish(
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
    // MessagingService handles cleanup
    this.logger.log('Queue management service shutting down');
  }
}
