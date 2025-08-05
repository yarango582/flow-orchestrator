export interface FlowExecution {
  id: string;
  flow_id: string;
  execution_id: string;
  flow_definition: any;
  input_data: any;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  current_step: number;
  total_steps: number;
  completed_steps: number[];
  failed_steps: number[];
  step_results: any;
  assigned_workers: string[];
  started_at?: Date;
  completed_at?: Date;
  total_execution_time_ms?: number;
  error_message?: string;
  error_stack?: string;
  retry_count: number;
  max_retries: number;
  priority: 'high' | 'normal' | 'low';
  tags: string[];
  metadata: any;
  created_at: Date;
  updated_at: Date;
}

export interface TaskExecution {
  id: string;
  task_id: string;
  flow_execution_id: string;
  step_index: number;
  node_id: string;
  node_type: string;
  assigned_worker_id?: string;
  assigned_at?: Date;
  status:
    | 'pending'
    | 'assigned'
    | 'running'
    | 'completed'
    | 'failed'
    | 'retrying';
  input_data: any;
  output_data: any;
  started_at?: Date;
  completed_at?: Date;
  execution_time_ms?: number;
  error_message?: string;
  error_details: any;
  retry_count: number;
  max_retries: number;
  priority: 'high' | 'normal' | 'low';
  metadata: any;
  created_at: Date;
  updated_at: Date;
}

export interface ExecutionLog {
  id: string;
  execution_id: string;
  task_id?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  node_id?: string;
  worker_id?: string;
  metadata: any;
  created_at: Date;
}

export interface ExecutionQueryParams {
  status?: string;
  flow_id?: string;
  priority?: string;
  page?: number;
  limit?: number;
  start_date?: string;
  end_date?: string;
}

export interface ExecutionSummary {
  execution_id: string;
  flow_id: string;
  status: string;
  progress_percentage: number;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  started_at?: Date;
  completed_at?: Date;
  total_execution_time_ms?: number;
}
