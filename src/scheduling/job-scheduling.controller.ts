import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  JobSchedulingService,
  ScheduledJob,
  JobExecutionResult,
} from './job-scheduling.service';

export interface CreateJobDto {
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
  retryPolicy: {
    maxRetries: number;
    retryDelay: number;
    exponentialBackoff: boolean;
  };
}

export interface UpdateJobDto extends Partial<CreateJobDto> {}

export interface JobToggleDto {
  enabled: boolean;
}

@Controller('jobs')
export class JobSchedulingController {
  private readonly logger = new Logger(JobSchedulingController.name);

  constructor(private readonly jobService: JobSchedulingService) {}

  /**
   * Create a new scheduled job
   */
  @Post()
  async createJob(
    @Body() createJobDto: CreateJobDto,
  ): Promise<{ jobId: string; message: string }> {
    try {
      this.logger.log(`📝 Creating new job: ${createJobDto.name}`);

      const jobId = await this.jobService.createScheduledJob(createJobDto);

      return {
        jobId,
        message: `Job '${createJobDto.name}' created successfully`,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to create job: ${createJobDto.name}`, error);
      throw new HttpException(
        `Failed to create job: ${error.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Get all scheduled jobs
   */
  @Get()
  async getAllJobs(
    @Query('enabled') enabled?: string,
    @Query('priority') priority?: string,
  ): Promise<{ jobs: ScheduledJob[]; count: number }> {
    try {
      let jobs = this.jobService.getAllJobs();

      // Filter by enabled status
      if (enabled !== undefined) {
        const isEnabled = enabled.toLowerCase() === 'true';
        jobs = jobs.filter((job) => job.enabled === isEnabled);
      }

      // Filter by priority
      if (priority) {
        jobs = jobs.filter((job) => job.priority === priority);
      }

      this.logger.debug(`📋 Retrieved ${jobs.length} jobs`);

      return {
        jobs,
        count: jobs.length,
      };
    } catch (error) {
      this.logger.error('❌ Failed to retrieve jobs', error);
      throw new HttpException(
        'Failed to retrieve jobs',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get a specific job by ID
   */
  @Get(':jobId')
  async getJob(@Param('jobId') jobId: string): Promise<ScheduledJob> {
    try {
      const job = this.jobService.getJob(jobId);

      if (!job) {
        throw new HttpException(
          `Job with ID '${jobId}' not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      this.logger.debug(`📋 Retrieved job: ${job.name} (${jobId})`);
      return job;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`❌ Failed to retrieve job ${jobId}`, error);
      throw new HttpException(
        'Failed to retrieve job',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update an existing job
   */
  @Put(':jobId')
  async updateJob(
    @Param('jobId') jobId: string,
    @Body() updateJobDto: UpdateJobDto,
  ): Promise<{ message: string }> {
    try {
      await this.jobService.updateScheduledJob(jobId, updateJobDto);

      this.logger.log(`📝 Updated job: ${jobId}`);

      return {
        message: `Job '${jobId}' updated successfully`,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to update job ${jobId}`, error);

      if (error.message.includes('not found')) {
        throw new HttpException(
          `Job with ID '${jobId}' not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        `Failed to update job: ${error.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Delete a scheduled job
   */
  @Delete(':jobId')
  async deleteJob(@Param('jobId') jobId: string): Promise<{ message: string }> {
    try {
      await this.jobService.deleteScheduledJob(jobId);

      this.logger.log(`🗑️ Deleted job: ${jobId}`);

      return {
        message: `Job '${jobId}' deleted successfully`,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to delete job ${jobId}`, error);

      if (error.message.includes('not found')) {
        throw new HttpException(
          `Job with ID '${jobId}' not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        `Failed to delete job: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Enable or disable a job
   */
  @Put(':jobId/toggle')
  async toggleJob(
    @Param('jobId') jobId: string,
    @Body() toggleDto: JobToggleDto,
  ): Promise<{ message: string }> {
    try {
      await this.jobService.toggleJob(jobId, toggleDto.enabled);

      const action = toggleDto.enabled ? 'enabled' : 'disabled';
      this.logger.log(`🔄 ${action} job: ${jobId}`);

      return {
        message: `Job '${jobId}' ${action} successfully`,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to toggle job ${jobId}`, error);

      if (error.message.includes('not found')) {
        throw new HttpException(
          `Job with ID '${jobId}' not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        `Failed to toggle job: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Execute a job immediately
   */
  @Post(':jobId/execute')
  async executeJob(
    @Param('jobId') jobId: string,
  ): Promise<{ executionId: string; message: string }> {
    try {
      const executionId = await this.jobService.executeJobNow(jobId);

      this.logger.log(`🚀 Manually executed job: ${jobId}`);

      return {
        executionId,
        message: `Job '${jobId}' executed successfully`,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to execute job ${jobId}`, error);

      if (error.message.includes('not found')) {
        throw new HttpException(
          `Job with ID '${jobId}' not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        `Failed to execute job: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get job execution history
   */
  @Get(':jobId/executions')
  async getJobExecutions(
    @Param('jobId') jobId: string,
    @Query('limit') limit?: string,
  ): Promise<{ executions: JobExecutionResult[]; count: number }> {
    try {
      let executions = this.jobService.getJobExecutions(jobId);

      // Apply limit if specified
      if (limit) {
        const limitNum = parseInt(limit, 10);
        if (!isNaN(limitNum) && limitNum > 0) {
          executions = executions.slice(-limitNum);
        }
      }

      this.logger.debug(
        `📊 Retrieved ${executions.length} executions for job ${jobId}`,
      );

      return {
        executions,
        count: executions.length,
      };
    } catch (error) {
      this.logger.error(
        `❌ Failed to retrieve executions for job ${jobId}`,
        error,
      );
      throw new HttpException(
        'Failed to retrieve job executions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get jobs statistics and overview
   */
  @Get('/statistics/overview')
  async getJobsStatistics(): Promise<any> {
    try {
      const stats = this.jobService.getJobsStatistics();

      this.logger.debug('📊 Retrieved jobs statistics');

      return {
        ...stats,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('❌ Failed to retrieve jobs statistics', error);
      throw new HttpException(
        'Failed to retrieve jobs statistics',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Validate cron expression
   */
  @Post('/validate/cron')
  async validateCronExpression(
    @Body() body: { cronExpression: string; timezone?: string },
  ): Promise<{ isValid: boolean; nextExecutions?: string[]; error?: string }> {
    try {
      const { cronExpression, timezone = 'UTC' } = body;

      const CronJob = require('cron').CronJob;

      try {
        const cronJob = new CronJob(
          cronExpression,
          () => {},
          null,
          false,
          timezone,
        );

        // Get next 5 execution times
        const nextExecutions: string[] = [];
        let nextDate = cronJob.nextDate();

        for (let i = 0; i < 5 && nextDate; i++) {
          nextExecutions.push(nextDate.toISOString());
          nextDate = cronJob.nextDate();
        }

        this.logger.debug(`✅ Validated cron expression: ${cronExpression}`);

        return {
          isValid: true,
          nextExecutions,
        };
      } catch (cronError) {
        this.logger.warn(
          `❌ Invalid cron expression: ${cronExpression}`,
          cronError,
        );

        return {
          isValid: false,
          error: cronError.message,
        };
      }
    } catch (error) {
      this.logger.error('❌ Failed to validate cron expression', error);
      throw new HttpException(
        'Failed to validate cron expression',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
