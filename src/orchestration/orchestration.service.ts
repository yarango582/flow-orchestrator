import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ExecutionService } from '../database/execution.service';
import { MessagingService } from '../messaging/messaging.service';
import {
  TaskMessage,
  ResultMessage,
  WorkerRegistrationMessage,
  WorkerHeartbeatMessage,
  TaskPriority,
  WorkerStatus,
} from 'flow-platform-node-core';

interface WorkerInfo {
  id: string;
  status: WorkerStatus;
  capabilities: string[];
  lastHeartbeat: Date;
  currentTasks: number;
  maxTasks: number;
  metadata: Record<string, any>;
}

@Injectable()
export class OrchestrationService implements OnModuleInit {
  private readonly logger = new Logger(OrchestrationService.name);
  private workers = new Map<string, WorkerInfo>();
  private taskAssignments = new Map<string, string>(); // taskId -> workerId

  constructor(
    private readonly executionService: ExecutionService,
    private readonly messagingService: MessagingService,
  ) {}

  async onModuleInit() {
    // Set reference in messaging service to handle worker events
    this.messagingService.setOrchestrationService(this);
    this.logger.log(
      '🔧 OrchestrationService initialized and linked with MessagingService',
    );
  }

  // ============================================================================
  // FLOW EXECUTION ORCHESTRATION
  // ============================================================================

  /**
   * Execute a complete flow by coordinating database and messaging
   */
  async executeFlow(
    executionId: string,
    flowDefinition: any,
    inputData: any = {},
    priority: TaskPriority = 'normal',
  ): Promise<void> {
    this.logger.log(`🚀 Starting flow execution: ${executionId}`);

    try {
      // 1. Create flow execution record in database
      const flowExecutionDbId = await this.executionService.createFlowExecution(
        {
          execution_id: executionId,
          flow_id: flowDefinition.id,
          flow_definition: flowDefinition,
          input_data: inputData,
          status: 'running',
          total_steps: flowDefinition.nodes?.length || 0,
          priority,
          started_at: new Date(),
        },
      );

      this.logger.log(
        `📝 Created DB record for execution: ${executionId} (ID: ${flowExecutionDbId})`,
      );

      // 2. Process nodes and create tasks
      const nodes = flowDefinition.nodes || [];

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        await this.scheduleNodeExecution(
          executionId,
          node,
          i,
          inputData,
          priority,
        );
      }

      this.logger.log(
        `✅ Scheduled ${nodes.length} tasks for execution: ${executionId}`,
      );
    } catch (error) {
      this.logger.error(`❌ Flow execution failed: ${executionId}`, error);
      await this.executionService.updateFlowExecutionStatus(
        executionId,
        'failed',
        {
          error_message: error.message,
          completed_at: new Date(),
        },
      );
      throw error;
    }
  }

  /**
   * Schedule execution of a single node
   */
  private async scheduleNodeExecution(
    executionId: string,
    node: any,
    stepIndex: number,
    inputData: any,
    priority: TaskPriority,
  ): Promise<void> {
    const taskId = `${executionId}-node-${node.id}-${stepIndex}-${Date.now()}`;

    // 1. Get flow execution DB record
    const flowExecution =
      await this.executionService.getFlowExecution(executionId);
    if (!flowExecution) {
      throw new Error(`Flow execution not found: ${executionId}`);
    }

    // 2. Create task execution record in database
    await this.executionService.createTaskExecution({
      task_id: taskId,
      flow_execution_id: flowExecution.id,
      step_index: stepIndex,
      node_id: node.id,
      node_type: node.type,
      status: 'pending',
      input_data: inputData,
      priority,
    });

    // 3. Find best available worker
    const assignedWorker = await this.findBestWorker(node.type);
    if (!assignedWorker) {
      this.logger.warn(
        `⚠️ No available worker for node type: ${node.type}. Task queued.`,
      );
      // Task remains in 'pending' status until worker becomes available
      await this.queueTaskForLater(taskId, node.type, priority);
      return;
    }

    // 4. Assign task to worker
    await this.assignTaskToWorker(
      taskId,
      assignedWorker,
      node,
      inputData,
      priority,
      flowExecution,
    );
  }

  /**
   * Assign a task to a specific worker
   */
  private async assignTaskToWorker(
    taskId: string,
    worker: WorkerInfo,
    node: any,
    inputData: any,
    priority: TaskPriority,
    flowExecution: any,
  ): Promise<void> {
    // 1. Record assignment
    this.taskAssignments.set(taskId, worker.id);
    worker.currentTasks++;

    // 2. Update task status in database
    await this.executionService.updateTaskStatus(taskId, 'assigned', {
      assigned_worker_id: worker.id,
    });

    // 3. Create RabbitMQ task message
    const taskMessage: TaskMessage = {
      id: taskId,
      timestamp: new Date().toISOString(),
      correlationId: flowExecution.execution_id,
      version: '1.0',
      flowId: flowExecution.flow_id,
      nodeId: node.id,
      nodeType: node.type,
      priority,
      configuration: node.configuration || {},
      inputs: inputData,
      metadata: {
        createdAt: new Date().toISOString(),
        flowName: flowExecution.flow_definition?.name || 'Unknown',
        nodeIndex: node.step_index || 0,
        totalNodes: flowExecution.total_steps,
      },
      retry: {
        attempts: 0,
        maxAttempts: 3,
        backoffMs: 1000,
      },
      timeout: {
        executionTimeoutMs: 300000, // 5 minutes
        queueTimeoutMs: 60000, // 1 minute
      },
    };

    // 4. Send task to RabbitMQ
    await this.messagingService.distributeTask(taskMessage, priority);

    // 5. Update task status to running
    await this.executionService.updateTaskStatus(taskId, 'running', {
      started_at: new Date(),
    });

    this.logger.log(
      `📤 Assigned task ${taskId} to worker ${worker.id} (${node.type})`,
    );
  }

  // ============================================================================
  // WORKER MANAGEMENT
  // ============================================================================

  /**
   * Handle worker registration
   */
  async handleWorkerRegistration(
    message: WorkerRegistrationMessage,
  ): Promise<void> {
    const worker: WorkerInfo = {
      id: message.workerId,
      status: message.status,
      capabilities: message.supportedNodeTypes,
      lastHeartbeat: new Date(),
      currentTasks: 0,
      maxTasks: message.capacity.maxConcurrentNodes || 5,
      metadata: message.metadata || {},
    };

    this.workers.set(message.workerId, worker);
    this.logger.log(
      `👷 Worker registered: ${message.workerId} (${message.supportedNodeTypes.join(', ')})`,
    );

    // Check for pending tasks that this worker can handle
    await this.processPendingTasksForWorker(worker);
  }

  /**
   * Handle worker heartbeat
   */
  async handleWorkerHeartbeat(message: WorkerHeartbeatMessage): Promise<void> {
    const worker = this.workers.get(message.workerId);
    if (worker) {
      worker.lastHeartbeat = new Date();
      // Map health status to worker status
      worker.status = message.status === 'healthy' ? 'available' : 'offline';
      worker.currentTasks = message.currentLoad.activeNodes || 0;

      this.logger.debug(
        `💓 Heartbeat from worker ${message.workerId}: ${message.status}`,
      );

      // If worker became available, check for pending tasks
      if (
        worker.status === 'available' &&
        worker.currentTasks < worker.maxTasks
      ) {
        await this.processPendingTasksForWorker(worker);
      }
    }
  }

  /**
   * Handle task execution result from worker
   */
  async handleTaskResult(message: ResultMessage): Promise<void> {
    const taskId = message.taskId;
    const workerId = this.taskAssignments.get(taskId);

    this.logger.log(`📥 Received result for task ${taskId}: ${message.status}`);

    try {
      // 1. Update task status in database
      await this.executionService.updateTaskStatus(
        taskId,
        message.status as any,
        {
          output_data: message.outputs,
          error_message: message.error?.message,
          completed_at: new Date(),
          execution_time_ms: message.metadata?.duration,
        },
      );

      // 2. Update worker current task count
      if (workerId) {
        const worker = this.workers.get(workerId);
        if (worker && worker.currentTasks > 0) {
          worker.currentTasks--;
        }
        this.taskAssignments.delete(taskId);

        // Check for more pending tasks for this worker
        if (
          worker &&
          worker.status === 'available' &&
          worker.currentTasks < worker.maxTasks
        ) {
          await this.processPendingTasksForWorker(worker);
        }
      }

      // 3. Check if flow execution is complete
      await this.checkFlowCompletion(message.correlationId || '');
    } catch (error) {
      this.logger.error(`❌ Error handling task result for ${taskId}:`, error);
    }
  }

  // ============================================================================
  // TASK QUEUE MANAGEMENT
  // ============================================================================

  /**
   * Find the best available worker for a specific node type
   */
  private async findBestWorker(nodeType: string): Promise<WorkerInfo | null> {
    const availableWorkers = Array.from(this.workers.values()).filter(
      (worker) =>
        worker.status === 'available' &&
        worker.capabilities.includes(nodeType) &&
        worker.currentTasks < worker.maxTasks,
    );

    if (availableWorkers.length === 0) {
      return null;
    }

    // Sort by current load (ascending) and last heartbeat (descending)
    availableWorkers.sort((a, b) => {
      const loadDiff = a.currentTasks - b.currentTasks;
      if (loadDiff !== 0) return loadDiff;
      return b.lastHeartbeat.getTime() - a.lastHeartbeat.getTime();
    });

    return availableWorkers[0];
  }

  /**
   * Queue task for later execution when no worker is available
   */
  private async queueTaskForLater(
    taskId: string,
    nodeType: string,
    priority: TaskPriority,
  ): Promise<void> {
    // Task stays in 'pending' status in database
    // Will be picked up when a suitable worker becomes available
    this.logger.log(
      `📋 Queued task ${taskId} for node type ${nodeType} (priority: ${priority})`,
    );
  }

  /**
   * Process pending tasks when a worker becomes available
   */
  private async processPendingTasksForWorker(
    worker: WorkerInfo,
  ): Promise<void> {
    if (worker.currentTasks >= worker.maxTasks) {
      return;
    }

    // Find pending tasks that this worker can handle
    const { executions } = await this.executionService.getAllExecutions({
      status: 'running',
      limit: 50,
    });

    for (const execution of executions) {
      if (worker.currentTasks >= worker.maxTasks) break;

      const tasks = await this.executionService.getTasksByExecution(
        execution.execution_id,
      );
      const pendingTasks = tasks.filter(
        (task) =>
          task.status === 'pending' &&
          worker.capabilities.includes(task.node_type),
      );

      for (const task of pendingTasks) {
        if (worker.currentTasks >= worker.maxTasks) break;

        // Get flow execution details
        const flowExecution = await this.executionService.getFlowExecution(
          execution.execution_id,
        );
        if (!flowExecution) continue;

        // Find the node definition
        const node = flowExecution.flow_definition?.nodes?.find(
          (n: any) => n.id === task.node_id,
        );
        if (!node) continue;

        // Assign task to worker
        await this.assignTaskToWorker(
          task.task_id,
          worker,
          node,
          task.input_data,
          task.priority as TaskPriority,
          flowExecution,
        );
      }
    }
  }

  /**
   * Check if a flow execution is complete and update status
   */
  private async checkFlowCompletion(executionId: string): Promise<void> {
    const flowExecution =
      await this.executionService.getFlowExecution(executionId);
    if (!flowExecution) return;

    const tasks = await this.executionService.getTasksByExecution(executionId);

    const completedTasks = tasks.filter((t) => t.status === 'completed').length;
    const failedTasks = tasks.filter((t) => t.status === 'failed').length;
    const totalTasks = tasks.length;

    // Update current step
    await this.executionService.updateFlowExecutionStatus(
      executionId,
      flowExecution.status,
      {
        current_step: completedTasks + failedTasks,
      },
    );

    // Check if all tasks are done
    if (completedTasks + failedTasks === totalTasks) {
      const finalStatus = failedTasks > 0 ? 'failed' : 'completed';
      const executionTime =
        Date.now() - (flowExecution.started_at?.getTime() || 0);

      await this.executionService.updateFlowExecutionStatus(
        executionId,
        finalStatus,
        {
          completed_at: new Date(),
          total_execution_time_ms: executionTime,
        },
      );

      this.logger.log(
        `✅ Flow execution ${executionId} completed with status: ${finalStatus}`,
      );
    }
  }

  // ============================================================================
  // EXECUTION CONTROL
  // ============================================================================

  /**
   * Retry a failed execution
   */
  async retryExecution(executionId: string): Promise<string> {
    const flowExecution =
      await this.executionService.getFlowExecution(executionId);
    if (!flowExecution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    const newExecutionId =
      await this.executionService.retryExecution(executionId);

    // Execute the retried flow
    await this.executeFlow(
      newExecutionId,
      flowExecution.flow_definition,
      flowExecution.input_data,
      flowExecution.priority as TaskPriority,
    );

    return newExecutionId;
  }

  /**
   * Cancel a running execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    await this.executionService.cancelExecution(executionId);

    // TODO: Send cancellation messages to workers for running tasks
    // This would require extending the RabbitMQ protocol
    this.logger.log(`🛑 Cancelled execution: ${executionId}`);
  }

  // ============================================================================
  // STATUS QUERIES
  // ============================================================================

  /**
   * Get current worker status
   */
  getWorkerStatus(): WorkerInfo[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get orchestration statistics
   */
  async getOrchestrationStats(): Promise<any> {
    const workerStats = {
      total: this.workers.size,
      available: Array.from(this.workers.values()).filter(
        (w) => w.status === 'available',
      ).length,
      busy: Array.from(this.workers.values()).filter((w) => w.status === 'busy')
        .length,
      offline: Array.from(this.workers.values()).filter(
        (w) => w.status === 'offline',
      ).length,
    };

    const taskStats = {
      activeTasks: Array.from(this.workers.values()).reduce(
        (sum, w) => sum + w.currentTasks,
        0,
      ),
      assignedTasks: this.taskAssignments.size,
    };

    const { executions } = await this.executionService.getAllExecutions({
      limit: 1,
    });
    const executionStats = {
      totalExecutions: executions.length,
    };

    return {
      workers: workerStats,
      tasks: taskStats,
      executions: executionStats,
      timestamp: new Date().toISOString(),
    };
  }
}
