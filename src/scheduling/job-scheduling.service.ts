import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { RabbitMQClient, FlowExecutionMessage } from 'flow-platform-node-core';
import { OrchestratorConfigService } from '../config/orchestrator-config.service';
import { QueueManagementService } from '../queue/queue-management.service';

export interface ScheduledJob {
  id: string;
  name: string;
  flowId: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  priority: 'high' | 'normal' | 'low';
  flowData: {
    name: string;
    version: number;
    nodes: Array<{
      id: string;
      type: string;
      config: Record<string, any>;
      position?: { x: number; y: number };
    }>;
    connections: Array<{
      sourceId: string;
      targetId: string;
      sourcePort?: string;
      targetPort?: string;
    }>;
  };
  inputs?: Record<string, any>;
  metadata: {
    createdBy?: string;
    createdAt: Date;
    lastExecution?: Date;
    nextExecution?: Date;
    executionCount: number;
    failureCount: number;
  };
  retryPolicy: {
    maxRetries: number;
    retryDelay: number;
    exponentialBackoff: boolean;
  };
}

export interface JobExecutionResult {
  jobId: string;
  executionId: string;
  status: 'success' | 'failed' | 'timeout';
  startTime: Date;
  endTime?: Date;
  error?: string;
  taskId?: string;
}

@Injectable()
export class JobSchedulingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobSchedulingService.name);
  private readonly scheduledJobs = new Map<string, ScheduledJob>();
  private readonly jobExecutions = new Map<string, JobExecutionResult[]>();
  private readonly rabbitMQClient: RabbitMQClient;

  // Job persistence - in a real implementation this would use database
  private jobPersistenceInterval: NodeJS.Timeout;

  constructor(
    private readonly config: OrchestratorConfigService,
    private readonly queueService: QueueManagementService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.rabbitMQClient = new RabbitMQClient({
      url: this.config.rabbitmqUrl,
      exchange: this.config.rabbitmqExchange,
      prefetch: this.config.rabbitmqPrefetch,
    });
  }

  async onModuleInit() {
    await this.initializeScheduling();
    await this.loadPersistedJobs();
    this.startJobPersistence();
    this.logger.log('✅ Job Scheduling System initialized');
  }

  private async initializeScheduling() {
    try {
      await this.rabbitMQClient.connect();
      this.logger.log('🔗 RabbitMQ connected for job scheduling');
    } catch (error) {
      this.logger.error('❌ Failed to initialize job scheduling', error);
      throw error;
    }
  }

  /**
   * Create a new scheduled job
   */
  async createScheduledJob(
    jobData: Omit<ScheduledJob, 'id' | 'metadata'>,
  ): Promise<string> {
    try {
      const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const job: ScheduledJob = {
        ...jobData,
        id: jobId,
        metadata: {
          createdBy: 'orchestrator',
          createdAt: new Date(),
          executionCount: 0,
          failureCount: 0,
          nextExecution: this.calculateNextExecution(
            jobData.cronExpression,
            jobData.timezone,
          ),
        },
      };

      this.scheduledJobs.set(jobId, job);
      this.jobExecutions.set(jobId, []);

      if (job.enabled) {
        await this.scheduleJob(job);
      }

      this.logger.log(`📅 Scheduled job created: ${job.name} (${jobId})`);
      return jobId;
    } catch (error) {
      this.logger.error('❌ Failed to create scheduled job', error);
      throw error;
    }
  }

  /**
   * Update an existing scheduled job
   */
  async updateScheduledJob(
    jobId: string,
    updates: Partial<ScheduledJob>,
  ): Promise<void> {
    try {
      const existingJob = this.scheduledJobs.get(jobId);
      if (!existingJob) {
        throw new Error(`Job ${jobId} not found`);
      }

      // Remove old schedule if cron or timezone changed
      if (updates.cronExpression || updates.timezone) {
        this.unscheduleJob(jobId);
      }

      const updatedJob: ScheduledJob = {
        ...existingJob,
        ...updates,
        metadata: {
          ...existingJob.metadata,
          nextExecution:
            updates.cronExpression || updates.timezone
              ? this.calculateNextExecution(
                  updates.cronExpression || existingJob.cronExpression,
                  updates.timezone || existingJob.timezone,
                )
              : existingJob.metadata.nextExecution,
        },
      };

      this.scheduledJobs.set(jobId, updatedJob);

      // Reschedule if enabled
      if (updatedJob.enabled) {
        await this.scheduleJob(updatedJob);
      }

      this.logger.log(
        `📝 Updated scheduled job: ${updatedJob.name} (${jobId})`,
      );
    } catch (error) {
      this.logger.error(`❌ Failed to update job ${jobId}`, error);
      throw error;
    }
  }

  /**
   * Delete a scheduled job
   */
  async deleteScheduledJob(jobId: string): Promise<void> {
    try {
      const job = this.scheduledJobs.get(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }

      // Remove from scheduler
      this.unscheduleJob(jobId);

      // Remove from memory
      this.scheduledJobs.delete(jobId);
      this.jobExecutions.delete(jobId);

      this.logger.log(`🗑️ Deleted scheduled job: ${job.name} (${jobId})`);
    } catch (error) {
      this.logger.error(`❌ Failed to delete job ${jobId}`, error);
      throw error;
    }
  }

  /**
   * Enable/disable a scheduled job
   */
  async toggleJob(jobId: string, enabled: boolean): Promise<void> {
    try {
      const job = this.scheduledJobs.get(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }

      job.enabled = enabled;

      if (enabled) {
        await this.scheduleJob(job);
        this.logger.log(`▶️ Enabled job: ${job.name} (${jobId})`);
      } else {
        this.unscheduleJob(jobId);
        this.logger.log(`⏸️ Disabled job: ${job.name} (${jobId})`);
      }
    } catch (error) {
      this.logger.error(`❌ Failed to toggle job ${jobId}`, error);
      throw error;
    }
  }

  /**
   * Execute a job immediately (manual trigger)
   */
  async executeJobNow(jobId: string): Promise<string> {
    try {
      const job = this.scheduledJobs.get(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }

      return await this.executeJob(job, 'manual');
    } catch (error) {
      this.logger.error(`❌ Failed to execute job ${jobId}`, error);
      throw error;
    }
  }

  /**
   * Get all scheduled jobs
   */
  getAllJobs(): ScheduledJob[] {
    return Array.from(this.scheduledJobs.values());
  }

  /**
   * Get job by ID
   */
  getJob(jobId: string): ScheduledJob | undefined {
    return this.scheduledJobs.get(jobId);
  }

  /**
   * Get job execution history
   */
  getJobExecutions(jobId: string): JobExecutionResult[] {
    return this.jobExecutions.get(jobId) || [];
  }

  /**
   * Get jobs statistics
   */
  getJobsStatistics() {
    const jobs = Array.from(this.scheduledJobs.values());

    return {
      total: jobs.length,
      enabled: jobs.filter((j) => j.enabled).length,
      disabled: jobs.filter((j) => !j.enabled).length,
      byPriority: {
        high: jobs.filter((j) => j.priority === 'high').length,
        normal: jobs.filter((j) => j.priority === 'normal').length,
        low: jobs.filter((j) => j.priority === 'low').length,
      },
      totalExecutions: jobs.reduce(
        (sum, j) => sum + j.metadata.executionCount,
        0,
      ),
      totalFailures: jobs.reduce((sum, j) => sum + j.metadata.failureCount, 0),
      upcomingJobs: jobs
        .filter((j) => j.enabled && j.metadata.nextExecution)
        .sort(
          (a, b) =>
            (a.metadata.nextExecution?.getTime() || 0) -
            (b.metadata.nextExecution?.getTime() || 0),
        )
        .slice(0, 10),
    };
  }

  private async scheduleJob(job: ScheduledJob): Promise<void> {
    try {
      // Remove existing schedule if any
      this.unscheduleJob(job.id);

      // Create cron job with timezone support
      const cronJob = new (require('cron').CronJob)(
        job.cronExpression,
        async () => {
          await this.executeJob(job, 'scheduled');
        },
        null,
        false,
        job.timezone,
      );

      // Add to NestJS scheduler registry
      this.schedulerRegistry.addCronJob(job.id, cronJob);
      cronJob.start();

      this.logger.debug(
        `⏰ Scheduled job: ${job.name} with cron '${job.cronExpression}' in timezone '${job.timezone}'`,
      );
    } catch (error) {
      this.logger.error(`❌ Failed to schedule job ${job.id}`, error);
      throw error;
    }
  }

  private unscheduleJob(jobId: string): void {
    try {
      if (this.schedulerRegistry.doesExist('cron', jobId)) {
        this.schedulerRegistry.deleteCronJob(jobId);
        this.logger.debug(`⏹️ Unscheduled job: ${jobId}`);
      }
    } catch (error) {
      this.logger.warn(`⚠️ Failed to unschedule job ${jobId}:`, error.message);
    }
  }

  private async executeJob(
    job: ScheduledJob,
    trigger: 'scheduled' | 'manual',
  ): Promise<string> {
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const execution: JobExecutionResult = {
      jobId: job.id,
      executionId,
      status: 'success',
      startTime: new Date(),
    };

    try {
      this.logger.log(
        `🚀 Executing job: ${job.name} (${job.id}) - Trigger: ${trigger}`,
      );

      // Create flow execution message
      const flowExecution: FlowExecutionMessage = {
        id: `job-${executionId}`,
        timestamp: new Date().toISOString(),
        version: '1.0',
        flowId: job.flowId,
        executionId,
        priority: job.priority,
        flowData: job.flowData,
        inputs: job.inputs || {},
        metadata: {
          triggeredBy: 'scheduled',
          scheduledAt: new Date().toISOString(),
        },
      };

      // Send to queue management service - now returns array of task IDs
      const taskIds = await this.queueService.publishFlowExecution(
        flowExecution,
        job.priority,
      );
      execution.taskId = taskIds.join(','); // Store all task IDs

      // Update job metadata
      job.metadata.executionCount++;
      job.metadata.lastExecution = new Date();
      job.metadata.nextExecution = this.calculateNextExecution(
        job.cronExpression,
        job.timezone,
      );

      execution.endTime = new Date();
      execution.status = 'success';

      this.logger.log(
        `✅ Job executed successfully: ${job.name} -> Task IDs: ${execution.taskId}`,
      );
    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date();
      execution.error = error.message;

      job.metadata.failureCount++;

      this.logger.error(`❌ Job execution failed: ${job.name}`, error);

      // Handle retry logic
      await this.handleJobRetry(job, execution);
    }

    // Store execution result
    const executions = this.jobExecutions.get(job.id) || [];
    executions.push(execution);

    // Keep only last 100 executions per job
    if (executions.length > 100) {
      executions.splice(0, executions.length - 100);
    }

    this.jobExecutions.set(job.id, executions);

    return executionId;
  }

  private async handleJobRetry(
    job: ScheduledJob,
    failedExecution: JobExecutionResult,
  ): Promise<void> {
    if (job.retryPolicy.maxRetries > 0) {
      const recentFailures = this.getRecentFailures(job.id);

      if (recentFailures < job.retryPolicy.maxRetries) {
        const delay = job.retryPolicy.exponentialBackoff
          ? job.retryPolicy.retryDelay * Math.pow(2, recentFailures)
          : job.retryPolicy.retryDelay;

        setTimeout(async () => {
          this.logger.log(
            `🔄 Retrying job: ${job.name} (attempt ${recentFailures + 1}/${job.retryPolicy.maxRetries})`,
          );
          await this.executeJob(job, 'scheduled');
        }, delay);
      } else {
        this.logger.error(
          `💥 Job exhausted retries: ${job.name} - Disabling job`,
        );
        job.enabled = false;
        this.unscheduleJob(job.id);
      }
    }
  }

  private getRecentFailures(jobId: string): number {
    const executions = this.jobExecutions.get(jobId) || [];
    const recentExecutions = executions.slice(-10); // Last 10 executions
    return recentExecutions.filter((e) => e.status === 'failed').length;
  }

  private calculateNextExecution(
    cronExpression: string,
    timezone: string,
  ): Date | undefined {
    try {
      const CronJob = require('cron').CronJob;
      const cronJob = new CronJob(
        cronExpression,
        () => {},
        null,
        false,
        timezone,
      );
      return cronJob.nextDate()?.toDate();
    } catch (error) {
      this.logger.warn(
        `⚠️ Failed to calculate next execution for cron '${cronExpression}'`,
        error,
      );
      return undefined;
    }
  }

  private async loadPersistedJobs(): Promise<void> {
    try {
      // In a real implementation, this would load from database
      // For now, we'll add some example jobs

      this.logger.log('📂 Loading persisted jobs...');

      // Example: Daily data processing job
      await this.createScheduledJob({
        name: 'Daily Data Processing',
        flowId: 'daily-processing-flow',
        cronExpression: '0 2 * * *', // Every day at 2 AM
        timezone: 'America/New_York',
        enabled: true,
        priority: 'normal',
        flowData: {
          name: 'Daily Data Processing Flow',
          version: 1,
          nodes: [
            {
              id: 'start',
              type: 'data-filter',
              config: { filter: 'daily_batch' },
            },
            {
              id: 'process',
              type: 'mongodb-operations',
              config: { operation: 'aggregate' },
            },
          ],
          connections: [
            {
              sourceId: 'start',
              targetId: 'process',
            },
          ],
        },
        retryPolicy: {
          maxRetries: 3,
          retryDelay: 300000, // 5 minutes
          exponentialBackoff: true,
        },
      });

      // Example: Hourly health check
      await this.createScheduledJob({
        name: 'System Health Check',
        flowId: 'health-check-flow',
        cronExpression: '0 * * * *', // Every hour
        timezone: 'UTC',
        enabled: true,
        priority: 'low',
        flowData: {
          name: 'System Health Check Flow',
          version: 1,
          nodes: [
            {
              id: 'health-check',
              type: 'health-monitor',
              config: { checkType: 'full' },
            },
          ],
          connections: [],
        },
        retryPolicy: {
          maxRetries: 1,
          retryDelay: 60000, // 1 minute
          exponentialBackoff: false,
        },
      });

      this.logger.log(`✅ Loaded ${this.scheduledJobs.size} persisted jobs`);
    } catch (error) {
      this.logger.error('❌ Failed to load persisted jobs', error);
    }
  }

  private startJobPersistence(): void {
    // Persist job state every 5 minutes
    this.jobPersistenceInterval = setInterval(async () => {
      await this.persistJobs();
    }, 300000);
  }

  private async persistJobs(): Promise<void> {
    try {
      // In a real implementation, this would save to database
      const jobsData = Array.from(this.scheduledJobs.values());

      this.logger.debug(`💾 Persisting ${jobsData.length} jobs to storage`);

      // Here you would implement database persistence
      // await this.jobRepository.saveJobs(jobsData);
    } catch (error) {
      this.logger.error('❌ Failed to persist jobs', error);
    }
  }

  async onModuleDestroy() {
    try {
      // Clear all scheduled jobs
      for (const jobId of this.scheduledJobs.keys()) {
        this.unscheduleJob(jobId);
      }

      // Clear persistence interval
      if (this.jobPersistenceInterval) {
        clearInterval(this.jobPersistenceInterval);
      }

      // Final persistence
      await this.persistJobs();

      // Disconnect RabbitMQ
      await this.rabbitMQClient.disconnect();

      this.logger.log('🛑 Job Scheduling Service shut down gracefully');
    } catch (error) {
      this.logger.error('❌ Error during job scheduling shutdown', error);
    }
  }
}
