import { Injectable, Logger } from '@nestjs/common';
import { QueueManagementService } from '../queue/queue-management.service';
import { WorkerManagementService } from '../worker/worker-management.service';
import { FlowExecutionMessage, TaskMessage } from 'flow-platform-node-core';

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly queueService: QueueManagementService,
    private readonly workerService: WorkerManagementService,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 Orchestrator Service starting...');

    // Services initialize themselves through their onModuleInit
    await this.startTaskDistribution();

    this.logger.log('✅ Orchestrator Service ready');
  }

  /**
   * Main entry point for flow execution requests from API Gateway
   */
  async executeFlow(
    flowExecution: FlowExecutionMessage,
    priority: 'high' | 'normal' | 'low' = 'normal',
  ): Promise<string> {
    try {
      this.logger.log(
        `🔄 Executing flow ${flowExecution.flowId} with execution ID ${flowExecution.executionId}`,
      );

      // Publish flow execution to appropriate queue
      const taskId = await this.queueService.publishFlowExecution(
        flowExecution,
        priority,
      );

      this.logger.log(`✨ Flow execution queued with task ID: ${taskId}`);
      return taskId;
    } catch (error) {
      this.logger.error(
        `❌ Failed to execute flow ${flowExecution.flowId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Task distribution loop - connects queue management with worker management
   */
  private async startTaskDistribution() {
    this.logger.log('🔄 Starting task distribution system...');

    // This would be implemented as a more sophisticated system that:
    // 1. Monitors queue depths
    // 2. Assigns tasks to workers based on load balancing
    // 3. Handles failed task redistribution
    // 4. Manages task priorities

    // For now, we log that the system is ready
    this.logger.log('✅ Task distribution system ready');
  }

  /**
   * Get system health and statistics
   */
  async getSystemStats() {
    try {
      const [queueStats, workerStats] = await Promise.all([
        this.queueService.getQueueStats(),
        this.workerService.getWorkerStats(),
      ]);

      return {
        timestamp: new Date().toISOString(),
        queues: queueStats,
        workers: workerStats,
        system: {
          status: 'healthy',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        },
      };
    } catch (error) {
      this.logger.error('Failed to get system stats', error);
      throw error;
    }
  }

  /**
   * Handle task assignment - called when tasks are ready for distribution
   */
  async assignTask(task: TaskMessage): Promise<boolean> {
    try {
      const assignedWorkerId =
        await this.workerService.assignTaskToWorker(task);

      if (assignedWorkerId) {
        this.logger.log(
          `✅ Task ${task.id} assigned to worker ${assignedWorkerId}`,
        );
        return true;
      } else {
        this.logger.warn(`⚠️ No available worker for task ${task.id}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`❌ Failed to assign task ${task.id}`, error);
      return false;
    }
  }

  async onModuleDestroy() {
    this.logger.log('🛑 Orchestrator Service shutting down...');
  }
}
