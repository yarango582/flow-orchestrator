import { Controller, Post, Get, Body, Logger } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { FlowExecutionMessage } from 'flow-platform-node-core';

export interface ExecuteFlowDto {
  flowId: string;
  executionId: string;
  inputs?: Record<string, any>;
  priority?: 'high' | 'normal' | 'low';
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
  metadata?: {
    userId?: string;
    triggeredBy?: 'manual' | 'scheduled' | 'webhook' | 'api';
    scheduledAt?: string;
  };
}

@Controller('orchestrator')
export class OrchestratorController {
  private readonly logger = new Logger(OrchestratorController.name);

  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Post('execute')
  async executeFlow(@Body() dto: ExecuteFlowDto) {
    try {
      const flowExecution: FlowExecutionMessage = {
        id: `exec-${dto.executionId}`,
        timestamp: new Date().toISOString(),
        version: '1.0',
        flowId: dto.flowId,
        executionId: dto.executionId,
        priority: dto.priority || 'normal',
        flowData: dto.flowData,
        inputs: dto.inputs || {},
        metadata: {
          triggeredBy: dto.metadata?.triggeredBy || 'api',
          userId: dto.metadata?.userId,
          scheduledAt: dto.metadata?.scheduledAt,
        },
      };

      const taskId = await this.orchestratorService.executeFlow(
        flowExecution,
        dto.priority || 'normal',
      );

      return {
        success: true,
        taskId,
        message: 'Flow execution started successfully',
      };
    } catch (error) {
      this.logger.error('Failed to execute flow', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Get('health')
  async getHealth() {
    try {
      const stats = await this.orchestratorService.getSystemStats();

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        ...stats,
      };
    } catch (error) {
      this.logger.error('Health check failed', error);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('stats')
  async getStats() {
    return await this.orchestratorService.getSystemStats();
  }
}
