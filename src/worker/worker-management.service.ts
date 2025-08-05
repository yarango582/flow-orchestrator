import { Injectable, Logger } from '@nestjs/common';
import {
  Queues,
  WorkerRegistrationMessage,
  WorkerHeartbeatMessage,
  TaskMessage,
  WorkerStatus,
  HealthStatus,
} from 'flow-platform-node-core';
import { OrchestratorConfigService } from '../config/orchestrator-config.service';
import { MessagingService } from '../messaging/messaging.service';

export interface WorkerInfo {
  id: string;
  status: WorkerStatus;
  health: HealthStatus;
  capabilities: {
    maxConcurrentTasks: number;
    supportedNodeTypes: string[];
    memoryLimitMB: number;
    cpuCores: number;
  };
  performance: {
    currentLoad: number;
    tasksCompleted: number;
    tasksInProgress: number;
    averageExecutionTime: number;
    errorRate: number;
  };
  metadata: {
    registeredAt: Date;
    lastHeartbeat: Date;
    version: string;
    hostname: string;
    region?: string;
  };
}

export interface LoadBalancingStrategy {
  selectWorker(workers: WorkerInfo[], task: TaskMessage): string | null;
}

@Injectable()
export class WorkerManagementService {
  private readonly logger = new Logger(WorkerManagementService.name);
  private readonly workers = new Map<string, WorkerInfo>();
  private readonly loadBalancingStrategies = new Map<
    string,
    LoadBalancingStrategy
  >();

  private readonly queueNames = {
    workerRegistration: Queues.WORKER_REGISTRATION,
    workerHeartbeat: Queues.WORKER_HEARTBEAT,
    workerResults: Queues.WORKER_RESULTS,
  };

  constructor(
    private readonly config: OrchestratorConfigService,
    private readonly messagingService: MessagingService,
  ) {
    this.initializeLoadBalancingStrategies();
  }

  async onModuleInit() {
    await this.initializeWorkerManagement();
    await this.startHealthMonitoring();
    await this.startAutoScaling();
  }

  private async initializeWorkerManagement() {
    try {
      // MessagingService handles the connection, we just setup consumers
      await this.setupWorkerRegistrationConsumer();
      await this.setupWorkerHeartbeatConsumer();

      this.logger.log('Worker management system initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize worker management', error);
      throw error;
    }
  }

  private async setupWorkerRegistrationConsumer() {
    const rabbitClient = this.messagingService.getClient();

    await rabbitClient.consume(
      this.queueNames.workerRegistration,
      async (message) => {
        await this.handleWorkerRegistration(
          message as WorkerRegistrationMessage,
        );
      },
    );
  }

  private async setupWorkerHeartbeatConsumer() {
    const rabbitClient = this.messagingService.getClient();

    await rabbitClient.consume(
      this.queueNames.workerHeartbeat,
      async (message) => {
        await this.handleWorkerHeartbeat(message as WorkerHeartbeatMessage);
      },
    );
  }

  private async handleWorkerRegistration(
    registration: WorkerRegistrationMessage,
  ) {
    try {
      const workerInfo: WorkerInfo = {
        id: registration.workerId,
        status: 'available',
        health: 'healthy',
        capabilities: {
          maxConcurrentTasks: registration.capacity.maxConcurrentFlows,
          supportedNodeTypes: registration.supportedNodeTypes,
          memoryLimitMB: registration.capacity.memoryLimitMB,
          cpuCores: registration.capacity.cpuLimitCores,
        },
        performance: {
          currentLoad: 0,
          tasksCompleted: 0,
          tasksInProgress: 0,
          averageExecutionTime: 0,
          errorRate: 0,
        },
        metadata: {
          registeredAt: new Date(),
          lastHeartbeat: new Date(),
          version: registration.metadata.version,
          hostname: registration.hostname,
          region: registration.metadata.region,
        },
      };

      this.workers.set(registration.workerId, workerInfo);

      this.logger.log(
        `Worker registered: ${registration.workerId} with capacity: ${registration.capacity.maxConcurrentFlows} flows`,
      );

      // Notify other systems about new worker
      await this.broadcastWorkerStatus(workerInfo);
    } catch (error) {
      this.logger.error(
        `Failed to register worker ${registration.workerId}`,
        error,
      );
    }
  }

  private async handleWorkerHeartbeat(heartbeat: WorkerHeartbeatMessage) {
    try {
      const worker = this.workers.get(heartbeat.workerId);
      if (!worker) {
        this.logger.warn(
          `Received heartbeat from unregistered worker: ${heartbeat.workerId}`,
        );
        return;
      }

      // Update worker status
      worker.metadata.lastHeartbeat = new Date();
      // Map HealthStatus to WorkerStatus
      worker.status =
        heartbeat.status === 'healthy'
          ? 'available'
          : heartbeat.status === 'degraded'
            ? 'busy'
            : 'maintenance';
      worker.health = heartbeat.status;
      worker.performance = {
        ...worker.performance,
        currentLoad: heartbeat.currentLoad.memoryUsagePercent / 100,
        tasksInProgress: heartbeat.currentLoad.activeFlows,
      };

      // Check if worker needs attention
      if (heartbeat.status === 'critical') {
        this.logger.warn(
          `Worker ${heartbeat.workerId} reported critical health status`,
        );
        await this.handleCriticalWorker(heartbeat.workerId);
      }

      this.logger.debug(
        `Heartbeat received from worker: ${heartbeat.workerId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process heartbeat from worker ${heartbeat.workerId}`,
        error,
      );
    }
  }

  private async handleCriticalWorker(workerId: string) {
    try {
      const worker = this.workers.get(workerId);
      if (!worker) return;

      // Mark worker as maintenance mode
      worker.status = 'maintenance';

      // Redistribute tasks if needed
      await this.redistributeWorkerTasks(workerId);

      this.logger.warn(`Worker ${workerId} moved to maintenance mode`);
    } catch (error) {
      this.logger.error(`Failed to handle critical worker ${workerId}`, error);
    }
  }

  async assignTaskToWorker(task: TaskMessage): Promise<string | null> {
    try {
      const availableWorkers = Array.from(this.workers.values()).filter(
        (worker) =>
          worker.status === 'available' &&
          worker.health !== 'critical' &&
          worker.performance.currentLoad < 0.8 && // 80% max load
          worker.capabilities.supportedNodeTypes.includes(task.nodeType),
      );

      if (availableWorkers.length === 0) {
        this.logger.warn('No available workers for task assignment');

        // Trigger auto-scaling if enabled
        if (this.config.autoScalingEnabled) {
          await this.triggerAutoScaling();
        }

        return null;
      }

      // Select worker based on load balancing strategy
      const strategy = this.getLoadBalancingStrategy();
      const selectedWorker = strategy.selectWorker(availableWorkers, task);

      if (selectedWorker) {
        await this.assignTask(selectedWorker, task);
        this.logger.log(`Task ${task.id} assigned to worker ${selectedWorker}`);
      }

      return selectedWorker;
    } catch (error) {
      this.logger.error(`Failed to assign task ${task.id}`, error);
      return null;
    }
  }

  private getLoadBalancingStrategy(): LoadBalancingStrategy {
    const strategyName = this.config.loadBalanceStrategy;
    return (
      this.loadBalancingStrategies.get(strategyName) ||
      this.loadBalancingStrategies.get('round_robin')!
    );
  }

  private async assignTask(workerId: string, task: TaskMessage): Promise<void> {
    try {
      // Update worker load
      const worker = this.workers.get(workerId);
      if (worker) {
        worker.performance.tasksInProgress++;
        worker.performance.currentLoad =
          worker.performance.tasksInProgress /
          worker.capabilities.maxConcurrentTasks;
      }

      // Send task to specific worker queue
      await this.messagingService.distributeTask(task);

      this.logger.debug(`Task ${task.id} sent to worker ${workerId}`);
    } catch (error) {
      this.logger.error(`Failed to assign task to worker ${workerId}`, error);
      throw error;
    }
  }

  private async redistributeWorkerTasks(workerId: string): Promise<void> {
    try {
      this.logger.log(`Starting task redistribution from worker ${workerId}`);

      const failedWorker = this.workers.get(workerId);
      if (!failedWorker) {
        this.logger.warn(
          `Cannot redistribute tasks: worker ${workerId} not found`,
        );
        return;
      }

      // Get tasks currently assigned to the failed worker
      const tasksToRedistribute = failedWorker.performance.tasksInProgress;

      if (tasksToRedistribute === 0) {
        this.logger.log(`No tasks to redistribute from worker ${workerId}`);
        return;
      }

      // Find available workers that can handle the same node types
      const availableWorkers = Array.from(this.workers.values()).filter(
        (worker) =>
          worker.id !== workerId &&
          worker.status === 'available' &&
          worker.health !== 'critical' &&
          worker.performance.currentLoad < 0.7 && // 70% max load for redistrib
          // Check if worker supports at least some of the failed worker's capabilities
          worker.capabilities.supportedNodeTypes.some((nodeType) =>
            failedWorker.capabilities.supportedNodeTypes.includes(nodeType),
          ),
      );

      if (availableWorkers.length === 0) {
        this.logger.error(
          `No available workers for task redistribution from ${workerId}`,
        );

        // Send tasks to dead letter queue for later processing
        await this.sendTasksToDeadLetterQueue(workerId, tasksToRedistribute);
        return;
      }

      // Redistribute tasks evenly among available workers
      const tasksPerWorker = Math.ceil(
        tasksToRedistribute / availableWorkers.length,
      );
      let redistributedTasks = 0;

      for (const targetWorker of availableWorkers) {
        const remainingTasks = tasksToRedistribute - redistributedTasks;
        const tasksToAssign = Math.min(tasksPerWorker, remainingTasks);

        if (tasksToAssign > 0) {
          // Update target worker load
          targetWorker.performance.tasksInProgress += tasksToAssign;
          targetWorker.performance.currentLoad =
            targetWorker.performance.tasksInProgress /
            targetWorker.capabilities.maxConcurrentTasks;

          redistributedTasks += tasksToAssign;

          this.logger.log(
            `Redistributed ${tasksToAssign} tasks from ${workerId} to ${targetWorker.id}`,
          );
        }

        if (redistributedTasks >= tasksToRedistribute) {
          break;
        }
      }

      // Reset failed worker task count
      failedWorker.performance.tasksInProgress = 0;
      failedWorker.performance.currentLoad = 0;

      // Notify other services about task redistribution
      await this.notifyTaskRedistribution(
        workerId,
        redistributedTasks,
        availableWorkers.length,
      );

      this.logger.log(
        `Successfully redistributed ${redistributedTasks} tasks from worker ${workerId} to ${availableWorkers.length} workers`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to redistribute tasks from worker ${workerId}`,
        error,
      );
      throw error;
    }
  }

  private async sendTasksToDeadLetterQueue(
    workerId: string,
    taskCount: number,
  ): Promise<void> {
    try {
      const rabbitClient = this.messagingService.getClient();

      // Create a dead letter message for the failed tasks
      const deadLetterMessage = {
        id: `redistrib-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        failedWorkerId: workerId,
        taskCount,
        reason: 'worker_failure_redistribution',
        requiresManualIntervention: true,
        version: '1.0.0',
      };

      await rabbitClient.publish(
        this.config.rabbitmqExchange,
        Queues.DEAD_LETTER,
        deadLetterMessage,
        { persistent: true },
      );

      this.logger.warn(
        `Sent ${taskCount} tasks from failed worker ${workerId} to dead letter queue`,
      );
    } catch (error) {
      this.logger.error('Failed to send tasks to dead letter queue', error);
    }
  }

  private async notifyTaskRedistribution(
    failedWorkerId: string,
    taskCount: number,
    targetWorkerCount: number,
  ): Promise<void> {
    try {
      // In a production system, this would notify:
      // 1. Monitoring systems (Prometheus metrics)
      // 2. Alerting systems (PagerDuty, Slack)
      // 3. Logging aggregators (ELK stack)
      // 4. API Gateway for client notifications

      this.logger.log(
        `Task redistribution completed: ${taskCount} tasks from worker ${failedWorkerId} distributed to ${targetWorkerCount} workers`,
      );

      // You could implement webhook notifications, metrics updates, etc.
    } catch (error) {
      this.logger.error('Failed to notify task redistribution', error);
    }
  }

  private async triggerAutoScaling(): Promise<void> {
    try {
      const currentWorkerCount = this.getActiveWorkerCount();
      const maxWorkers = this.config.maxWorkers;

      if (currentWorkerCount < maxWorkers) {
        this.logger.log(
          'Triggering auto-scaling to create new worker instance',
        );

        // En un entorno real, esto podría:
        // 1. Crear nueva instancia en Docker/Kubernetes
        // 2. Notificar a un orchestrator externo
        // 3. Escalar horizontal en cloud provider

        // Por ahora solo loggeamos la acción
        this.logger.log(
          `Auto-scaling triggered: ${currentWorkerCount}/${maxWorkers} workers`,
        );
      } else {
        this.logger.warn('Max worker limit reached, cannot auto-scale');
      }
    } catch (error) {
      this.logger.error('Auto-scaling failed', error);
    }
  }

  private getActiveWorkerCount(): number {
    return Array.from(this.workers.values()).filter(
      (worker) => worker.status !== 'offline',
    ).length;
  }

  async getWorkerStats() {
    const workers = Array.from(this.workers.values());

    return {
      total: workers.length,
      available: workers.filter((w) => w.status === 'available').length,
      busy: workers.filter((w) => w.status === 'busy').length,
      maintenance: workers.filter((w) => w.status === 'maintenance').length,
      offline: workers.filter((w) => w.status === 'offline').length,
      averageLoad:
        workers.reduce((sum, w) => sum + w.performance.currentLoad, 0) /
          workers.length || 0,
      totalCapacity: workers.reduce(
        (sum, w) => sum + w.capabilities.maxConcurrentTasks,
        0,
      ),
      healthStatus: {
        healthy: workers.filter((w) => w.health === 'healthy').length,
        degraded: workers.filter((w) => w.health === 'degraded').length,
        critical: workers.filter((w) => w.health === 'critical').length,
      },
    };
  }

  private async startHealthMonitoring() {
    setInterval(async () => {
      await this.checkWorkerHealth();
    }, this.config.workerHealthCheckInterval);
  }

  private async checkWorkerHealth() {
    try {
      const now = new Date();
      const timeoutMs = this.config.workerTimeout;

      for (const [workerId, worker] of this.workers.entries()) {
        const timeSinceLastHeartbeat =
          now.getTime() - worker.metadata.lastHeartbeat.getTime();

        if (timeSinceLastHeartbeat > timeoutMs) {
          this.logger.warn(
            `Worker ${workerId} missed heartbeat, marking as offline`,
          );
          worker.status = 'offline';
          worker.health = 'critical';

          await this.redistributeWorkerTasks(workerId);
        }
      }
    } catch (error) {
      this.logger.error('Health monitoring failed', error);
    }
  }

  private async startAutoScaling() {
    if (!this.config.autoScalingEnabled) {
      return;
    }

    setInterval(async () => {
      await this.evaluateScalingNeeds();
    }, 60000); // Check every minute
  }

  private async evaluateScalingNeeds() {
    try {
      const stats = await this.getWorkerStats();
      const loadThreshold = 0.7; // 70%

      if (
        stats.averageLoad > loadThreshold &&
        stats.total < this.config.maxWorkers
      ) {
        await this.triggerAutoScaling();
      } else if (
        stats.averageLoad < 0.3 &&
        stats.total > this.config.minWorkers
      ) {
        this.logger.log('Considering scale-down due to low load');
        // Implement scale-down logic
      }
    } catch (error) {
      this.logger.error('Scaling evaluation failed', error);
    }
  }

  private initializeLoadBalancingStrategies() {
    // Round Robin Strategy
    let roundRobinIndex = 0;
    this.loadBalancingStrategies.set('round_robin', {
      selectWorker: (workers: WorkerInfo[]): string | null => {
        if (workers.length === 0) return null;
        const worker = workers[roundRobinIndex % workers.length];
        roundRobinIndex++;
        return worker.id;
      },
    });

    // Least Busy Strategy
    this.loadBalancingStrategies.set('least_busy', {
      selectWorker: (workers: WorkerInfo[]): string | null => {
        if (workers.length === 0) return null;
        const leastBusy = workers.reduce((min, worker) =>
          worker.performance.currentLoad < min.performance.currentLoad
            ? worker
            : min,
        );
        return leastBusy.id;
      },
    });

    // Weighted Strategy (based on capacity)
    this.loadBalancingStrategies.set('weighted', {
      selectWorker: (workers: WorkerInfo[]): string | null => {
        if (workers.length === 0) return null;

        // Select based on available capacity
        const withAvailableCapacity = workers
          .map((worker) => ({
            ...worker,
            availableCapacity:
              worker.capabilities.maxConcurrentTasks -
              worker.performance.tasksInProgress,
          }))
          .filter((w) => w.availableCapacity > 0);

        if (withAvailableCapacity.length === 0) return null;

        const bestCapacity = withAvailableCapacity.reduce((max, worker) =>
          worker.availableCapacity > max.availableCapacity ? worker : max,
        );
        return bestCapacity.id;
      },
    });
  }

  private async broadcastWorkerStatus(worker: WorkerInfo) {
    // Broadcast worker status to other interested services
    this.logger.debug(`Broadcasting status for worker ${worker.id}`);
  }

  async onModuleDestroy() {
    // MessagingService handles cleanup
    this.logger.log('Worker management service shutting down');
  }
}
