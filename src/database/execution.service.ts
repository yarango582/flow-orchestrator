import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';
import {
  FlowExecution,
  TaskExecution,
  ExecutionLog,
  ExecutionQueryParams,
  ExecutionSummary,
} from './database.types';

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(private readonly db: DatabaseService) {}

  // ============================================================================
  // FLOW EXECUTIONS
  // ============================================================================

  async createFlowExecution(data: Partial<FlowExecution>): Promise<string> {
    const query = `
      INSERT INTO flow_executions (
        flow_id, execution_id, flow_definition, input_data, 
        status, current_step, total_steps, priority, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `;

    const result = await this.db.query(query, [
      data.flow_id,
      data.execution_id,
      JSON.stringify(data.flow_definition),
      JSON.stringify(data.input_data || {}),
      data.status || 'pending',
      data.current_step || 0,
      data.total_steps || 0,
      data.priority || 'normal',
      JSON.stringify(data.metadata || {}),
    ]);

    this.logger.log(`📝 Created flow execution: ${data.execution_id}`);
    return result[0].id;
  }

  async getFlowExecution(executionId: string): Promise<FlowExecution | null> {
    const query = `
      SELECT * FROM flow_executions 
      WHERE execution_id = $1
    `;

    const result = await this.db.query<FlowExecution>(query, [executionId]);
    return result[0] || null;
  }

  async getAllExecutions(
    params: ExecutionQueryParams = {},
  ): Promise<{ executions: ExecutionSummary[]; total: number }> {
    let whereClause = 'WHERE 1=1';
    const queryParams: any[] = [];
    let paramIndex = 1;

    // Add filters
    if (params.status) {
      whereClause += ` AND fe.status = $${paramIndex}`;
      queryParams.push(params.status);
      paramIndex++;
    }

    if (params.flow_id) {
      whereClause += ` AND fe.flow_id = $${paramIndex}`;
      queryParams.push(params.flow_id);
      paramIndex++;
    }

    if (params.priority) {
      whereClause += ` AND fe.priority = $${paramIndex}`;
      queryParams.push(params.priority);
      paramIndex++;
    }

    if (params.start_date) {
      whereClause += ` AND fe.created_at >= $${paramIndex}`;
      queryParams.push(params.start_date);
      paramIndex++;
    }

    if (params.end_date) {
      whereClause += ` AND fe.created_at <= $${paramIndex}`;
      queryParams.push(params.end_date);
      paramIndex++;
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM flow_executions fe
      ${whereClause}
    `;

    const countResult = await this.db.query(countQuery, queryParams);
    const total = parseInt(countResult[0].total);

    // Get paginated results using the view
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        fe.execution_id,
        fe.flow_id,
        fe.status,
        fe.current_step,
        fe.total_steps,
        CASE 
          WHEN fe.total_steps > 0 
          THEN ROUND((fe.current_step::DECIMAL / fe.total_steps) * 100, 2)
          ELSE 0 
        END as progress_percentage,
        COUNT(te.id) as total_tasks,
        COUNT(CASE WHEN te.status = 'completed' THEN 1 END) as completed_tasks,
        COUNT(CASE WHEN te.status = 'failed' THEN 1 END) as failed_tasks,
        fe.started_at,
        fe.completed_at,
        fe.total_execution_time_ms,
        fe.created_at
      FROM flow_executions fe
      LEFT JOIN task_executions te ON fe.id = te.flow_execution_id
      ${whereClause}
      GROUP BY fe.id, fe.execution_id, fe.flow_id, fe.status, fe.current_step, 
               fe.total_steps, fe.started_at, fe.completed_at, fe.total_execution_time_ms, fe.created_at
      ORDER BY fe.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);
    const executions = await this.db.query<ExecutionSummary>(
      query,
      queryParams,
    );

    this.logger.debug(
      `📊 Retrieved ${executions.length} executions (total: ${total})`,
    );

    return { executions, total };
  }

  async updateFlowExecutionStatus(
    executionId: string,
    status: FlowExecution['status'],
    additionalData?: Partial<FlowExecution>,
  ): Promise<void> {
    let updateFields = 'status = $2, updated_at = CURRENT_TIMESTAMP';
    const params = [executionId, status];
    let paramIndex = 3;

    if (additionalData?.current_step !== undefined) {
      updateFields += `, current_step = $${paramIndex}`;
      params.push(additionalData.current_step.toString());
      paramIndex++;
    }

    if (additionalData?.error_message) {
      updateFields += `, error_message = $${paramIndex}`;
      params.push(additionalData.error_message);
      paramIndex++;
    }

    if (additionalData?.completed_at) {
      updateFields += `, completed_at = $${paramIndex}`;
      params.push(additionalData.completed_at.toISOString());
      paramIndex++;
    }

    if (additionalData?.total_execution_time_ms !== undefined) {
      updateFields += `, total_execution_time_ms = $${paramIndex}`;
      params.push(additionalData.total_execution_time_ms.toString());
      paramIndex++;
    }

    const query = `
      UPDATE flow_executions 
      SET ${updateFields}
      WHERE execution_id = $1
    `;

    await this.db.query(query, params);
    this.logger.log(`📝 Updated execution ${executionId} status to ${status}`);
  }

  // ============================================================================
  // TASK EXECUTIONS
  // ============================================================================

  async createTaskExecution(data: Partial<TaskExecution>): Promise<string> {
    const query = `
      INSERT INTO task_executions (
        task_id, flow_execution_id, step_index, node_id, node_type,
        status, input_data, priority, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `;

    const result = await this.db.query(query, [
      data.task_id,
      data.flow_execution_id,
      data.step_index,
      data.node_id,
      data.node_type,
      data.status || 'pending',
      JSON.stringify(data.input_data || {}),
      data.priority || 'normal',
      JSON.stringify(data.metadata || {}),
    ]);

    return result[0].id;
  }

  async getTasksByExecution(executionId: string): Promise<TaskExecution[]> {
    const query = `
      SELECT te.* 
      FROM task_executions te
      JOIN flow_executions fe ON te.flow_execution_id = fe.id
      WHERE fe.execution_id = $1
      ORDER BY te.step_index ASC
    `;

    return this.db.query<TaskExecution>(query, [executionId]);
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskExecution['status'],
    additionalData?: Partial<TaskExecution>,
  ): Promise<void> {
    let updateFields = 'status = $2, updated_at = CURRENT_TIMESTAMP';
    const params = [taskId, status];
    let paramIndex = 3;

    if (additionalData?.assigned_worker_id) {
      updateFields += `, assigned_worker_id = $${paramIndex}`;
      params.push(additionalData.assigned_worker_id);
      paramIndex++;
    }

    if (additionalData?.output_data) {
      updateFields += `, output_data = $${paramIndex}`;
      params.push(JSON.stringify(additionalData.output_data));
      paramIndex++;
    }

    if (additionalData?.error_message) {
      updateFields += `, error_message = $${paramIndex}`;
      params.push(additionalData.error_message);
      paramIndex++;
    }

    if (additionalData?.started_at) {
      updateFields += `, started_at = $${paramIndex}`;
      params.push(additionalData.started_at.toISOString());
      paramIndex++;
    }

    if (additionalData?.completed_at) {
      updateFields += `, completed_at = $${paramIndex}`;
      params.push(additionalData.completed_at.toISOString());
      paramIndex++;
    }

    if (additionalData?.execution_time_ms !== undefined) {
      updateFields += `, execution_time_ms = $${paramIndex}`;
      params.push(additionalData.execution_time_ms.toString());
      paramIndex++;
    }

    const query = `
      UPDATE task_executions 
      SET ${updateFields}
      WHERE task_id = $1
    `;

    await this.db.query(query, params);
  }

  // ============================================================================
  // EXECUTION LOGS (Simulado con tabla temporal)
  // ============================================================================

  async createExecutionLog(data: Partial<ExecutionLog>): Promise<void> {
    // Por ahora, simplemente loggeamos - en producción esto iría a una tabla logs
    this.logger.log(
      `[${data.level?.toUpperCase()}] ${data.execution_id} | ${data.node_id} | ${data.message}`,
    );

    // TODO: Implementar tabla de logs cuando sea necesario
    // const query = `
    //   INSERT INTO execution_logs (execution_id, task_id, level, message, node_id, worker_id, metadata)
    //   VALUES ($1, $2, $3, $4, $5, $6, $7)
    // `;
  }

  async getExecutionLogs(
    executionId: string,
    filters?: {
      level?: string;
      node_id?: string;
      limit?: number;
    },
  ): Promise<ExecutionLog[]> {
    // Por ahora devolvemos logs simulados basados en las tareas
    const tasks = await this.getTasksByExecution(executionId);

    const logs: ExecutionLog[] = [];

    tasks.forEach((task) => {
      logs.push({
        id: `log-${task.id}-start`,
        execution_id: executionId,
        task_id: task.task_id,
        level: 'info',
        message: `Task ${task.node_id} started`,
        node_id: task.node_id,
        metadata: {},
        created_at: task.started_at || task.created_at,
      });

      if (task.status === 'completed') {
        logs.push({
          id: `log-${task.id}-complete`,
          execution_id: executionId,
          task_id: task.task_id,
          level: 'info',
          message: `Task ${task.node_id} completed successfully`,
          node_id: task.node_id,
          metadata: {},
          created_at: task.completed_at || new Date(),
        });
      } else if (task.status === 'failed') {
        logs.push({
          id: `log-${task.id}-error`,
          execution_id: executionId,
          task_id: task.task_id,
          level: 'error',
          message: task.error_message || `Task ${task.node_id} failed`,
          node_id: task.node_id,
          metadata: {},
          created_at: task.completed_at || new Date(),
        });
      }
    });

    // Apply filters
    let filteredLogs = logs;
    if (filters?.level) {
      filteredLogs = filteredLogs.filter((log) => log.level === filters.level);
    }
    if (filters?.node_id) {
      filteredLogs = filteredLogs.filter(
        (log) => log.node_id === filters.node_id,
      );
    }

    // Sort by created_at and apply limit
    filteredLogs.sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime(),
    );

    if (filters?.limit) {
      filteredLogs = filteredLogs.slice(0, filters.limit);
    }

    return filteredLogs;
  }

  // ============================================================================
  // RETRY & CANCEL OPERATIONS
  // ============================================================================

  async retryExecution(executionId: string): Promise<string> {
    const execution = await this.getFlowExecution(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // Create new execution with retry suffix
    const newExecutionId = `${executionId}-retry-${Date.now()}`;

    await this.createFlowExecution({
      ...execution,
      execution_id: newExecutionId,
      status: 'pending',
      current_step: 0,
      retry_count: execution.retry_count + 1,
      started_at: undefined,
      completed_at: undefined,
      total_execution_time_ms: undefined,
      error_message: undefined,
      error_stack: undefined,
    });

    this.logger.log(`🔄 Created retry execution: ${newExecutionId}`);
    return newExecutionId;
  }

  async cancelExecution(executionId: string): Promise<void> {
    await this.updateFlowExecutionStatus(executionId, 'cancelled', {
      completed_at: new Date(),
    });

    // Cancel all pending/running tasks
    const query = `
      UPDATE task_executions 
      SET status = 'failed', 
          error_message = 'Execution cancelled by user',
          updated_at = CURRENT_TIMESTAMP
      WHERE flow_execution_id = (
        SELECT id FROM flow_executions WHERE execution_id = $1
      ) AND status IN ('pending', 'assigned', 'running')
    `;

    await this.db.query(query, [executionId]);
    this.logger.log(`❌ Cancelled execution: ${executionId}`);
  }
}
