import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ExecutionService } from '../database/execution.service';
import { OrchestrationService } from '../orchestration/orchestration.service';
import {
  FlowExecution,
  ExecutionQueryParams,
  ExecutionSummary,
} from '../database/database.types';

export interface ExecutionCreateRequest {
  flow_id: string;
  flow_definition: any;
  input_data?: any;
  priority?: 'low' | 'normal' | 'high';
  metadata?: any;
}

export interface ExecutionRetryRequest {
  reason?: string;
}

export interface ExecutionDetailsResponse {
  execution: FlowExecution;
  tasks: any[];
  logs: any[];
  summary: {
    total_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    pending_tasks: number;
    progress_percentage: number;
    estimated_remaining_time?: number;
  };
}

@Controller('jobs/executions')
export class ExecutionsController {
  private readonly logger = new Logger(ExecutionsController.name);

  constructor(
    private readonly executionService: ExecutionService,
    private readonly orchestrationService: OrchestrationService,
  ) {}

  // GET /jobs/executions - Lista todas las ejecuciones con filtros
  @Get()
  async getExecutions(@Query() query: ExecutionQueryParams): Promise<{
    executions: ExecutionSummary[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    this.logger.debug(
      `🔍 Fetching executions with filters: ${JSON.stringify(query)}`,
    );

    const { executions, total } =
      await this.executionService.getAllExecutions(query);

    const page = query.page || 1;
    const limit = query.limit || 20;
    const totalPages = Math.ceil(total / limit);

    return {
      executions,
      total,
      page,
      limit,
      totalPages,
    };
  }

  // GET /jobs/executions/:id - Obtiene detalles completos de una ejecución
  @Get(':id')
  async getExecutionDetails(
    @Param('id') executionId: string,
  ): Promise<ExecutionDetailsResponse> {
    this.logger.debug(`🔍 Fetching execution details: ${executionId}`);

    const execution = await this.executionService.getFlowExecution(executionId);
    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }

    const tasks = await this.executionService.getTasksByExecution(executionId);
    const logs = await this.executionService.getExecutionLogs(executionId, {
      limit: 100,
    });

    // Calculate summary statistics
    const total_tasks = tasks.length;
    const completed_tasks = tasks.filter(
      (t) => t.status === 'completed',
    ).length;
    const failed_tasks = tasks.filter((t) => t.status === 'failed').length;
    const pending_tasks = tasks.filter((t) =>
      ['pending', 'assigned', 'running'].includes(t.status),
    ).length;

    const progress_percentage =
      total_tasks > 0 ? Math.round((completed_tasks / total_tasks) * 100) : 0;

    return {
      execution,
      tasks,
      logs,
      summary: {
        total_tasks,
        completed_tasks,
        failed_tasks,
        pending_tasks,
        progress_percentage,
      },
    };
  }

  // POST /jobs/executions - Crea una nueva ejecución
  @Post()
  async createExecution(
    @Body() request: ExecutionCreateRequest,
  ): Promise<{ execution_id: string; message: string }> {
    this.logger.log(`📝 Creating new execution for flow: ${request.flow_id}`);

    if (!request.flow_id || !request.flow_definition) {
      throw new BadRequestException('flow_id and flow_definition are required');
    }

    // Generate execution ID
    const execution_id = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Execute the flow through the orchestration service
    await this.orchestrationService.executeFlow(
      execution_id,
      request.flow_definition,
      request.input_data,
      request.priority,
    );

    this.logger.log(`✅ Created execution: ${execution_id}`);

    return {
      execution_id,
      message: 'Execution created successfully',
    };
  }

  // POST /jobs/executions/:id/retry - Reintenta una ejecución fallida
  @Post(':id/retry')
  async retryExecution(
    @Param('id') executionId: string,
  ): Promise<{ new_execution_id: string; message: string }> {
    this.logger.log(`🔄 Retrying execution: ${executionId}`);

    const execution = await this.executionService.getFlowExecution(executionId);
    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }

    if (!['failed', 'cancelled'].includes(execution.status)) {
      throw new BadRequestException(
        `Cannot retry execution with status: ${execution.status}`,
      );
    }

    const newExecutionId =
      await this.orchestrationService.retryExecution(executionId);

    this.logger.log(`✅ Created retry execution: ${newExecutionId}`);

    return {
      new_execution_id: newExecutionId,
      message: `Retry execution created: ${newExecutionId}`,
    };
  }

  // POST /jobs/executions/:id/cancel - Cancela una ejecución en progreso
  @Post(':id/cancel')
  async cancelExecution(
    @Param('id') executionId: string,
  ): Promise<{ message: string }> {
    this.logger.log(`❌ Cancelling execution: ${executionId}`);

    const execution = await this.executionService.getFlowExecution(executionId);
    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }

    if (!['pending', 'running'].includes(execution.status)) {
      throw new BadRequestException(
        `Cannot cancel execution with status: ${execution.status}`,
      );
    }

    await this.orchestrationService.cancelExecution(executionId);

    this.logger.log(`✅ Cancelled execution: ${executionId}`);

    return {
      message: `Execution ${executionId} cancelled successfully`,
    };
  }

  // GET /jobs/executions/:id/logs - Obtiene logs de una ejecución
  @Get(':id/logs')
  async getExecutionLogs(
    @Param('id') executionId: string,
    @Query('level') level?: string,
    @Query('node_id') nodeId?: string,
    @Query('limit') limit?: string,
  ) {
    this.logger.debug(`📋 Fetching logs for execution: ${executionId}`);

    const execution = await this.executionService.getFlowExecution(executionId);
    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }

    const logs = await this.executionService.getExecutionLogs(executionId, {
      level,
      node_id: nodeId,
      limit: limit ? parseInt(limit) : 50,
    });

    return {
      execution_id: executionId,
      logs,
      total: logs.length,
    };
  }

  // GET /jobs/executions/:id/tasks - Obtiene tareas de una ejecución
  @Get(':id/tasks')
  async getExecutionTasks(@Param('id') executionId: string) {
    this.logger.debug(`📋 Fetching tasks for execution: ${executionId}`);

    const execution = await this.executionService.getFlowExecution(executionId);
    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }

    const tasks = await this.executionService.getTasksByExecution(executionId);

    return {
      execution_id: executionId,
      tasks,
      total: tasks.length,
    };
  }
}
