import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MessageFactory } from 'flow-platform-node-core';
import { v4 as uuidv4 } from 'uuid';
import { CreateFlowDto, UpdateFlowDto, FlowQueryDto, FlowStatus } from './dto';
import { Flow } from './flows.types';

// Exportar la interfaz para uso en el controlador
export { Flow } from './flows.types';

@Injectable()
export class FlowsService {
  private readonly logger = new Logger(FlowsService.name);
  private flows: Map<string, Flow> = new Map(); // Almacenamiento temporal

  async createFlow(createFlowDto: CreateFlowDto): Promise<Flow> {
    this.logger.log('Creating flow in orchestrator');

    const id = uuidv4();
    const now = new Date();

    const flow: Flow = {
      id,
      ...createFlowDto,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.validateFlow(flow);
    this.flows.set(id, flow);
    this.logger.log(`Flow created with ID: ${id}`);

    return flow;
  }

  async getFlows(query: FlowQueryDto) {
    this.logger.log('Getting flows from orchestrator');

    let allFlows = Array.from(this.flows.values());

    // Filtrar por status
    if (query.status) {
      allFlows = allFlows.filter((flow) => flow.status === query.status);
    }

    // Filtrar por búsqueda
    if (query.search) {
      const searchTerm = query.search.toLowerCase();
      allFlows = allFlows.filter(
        (flow) =>
          flow.name.toLowerCase().includes(searchTerm) ||
          flow.description?.toLowerCase().includes(searchTerm),
      );
    }

    // Ordenar por fecha de actualización (más recientes primero)
    allFlows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // Paginación
    const page = query.page || 1;
    const limit = query.limit || 10;
    const total = allFlows.length;
    const startIndex = (page - 1) * limit;
    const paginatedFlows = allFlows.slice(startIndex, startIndex + limit);

    return {
      data: paginatedFlows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getFlowById(id: string): Promise<Flow> {
    this.logger.log(`Getting flow ${id} from orchestrator`);

    const flow = this.flows.get(id);
    if (!flow) {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }

    return flow;
  }

  async updateFlow(id: string, updateFlowDto: UpdateFlowDto): Promise<Flow> {
    this.logger.log(`Updating flow ${id} in orchestrator`);

    const existingFlow = await this.getFlowById(id);

    const updatedFlow: Flow = {
      ...existingFlow,
      ...updateFlowDto,
      id,
      version: existingFlow.version + 1,
      updatedAt: new Date(),
    };

    this.validateFlow(updatedFlow);
    this.flows.set(id, updatedFlow);
    this.logger.log(`Flow updated with ID: ${id}`);

    return updatedFlow;
  }

  async deleteFlow(id: string): Promise<void> {
    this.logger.log(`Deleting flow ${id} from orchestrator`);

    if (!this.flows.delete(id)) {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }

    this.logger.log(`Flow deleted with ID: ${id}`);
  }

  async executeFlow(
    id: string,
    inputs: Record<string, any>,
  ): Promise<{ executionId: string }> {
    this.logger.log(`Executing flow ${id}`);

    const flow = await this.getFlowById(id);

    if (flow.status !== FlowStatus.ACTIVE) {
      throw new BadRequestException(
        `Flow with ID ${id} is not active and cannot be executed.`,
      );
    }

    // Crear mensaje de ejecución usando node-core
    const executionMessage = MessageFactory.createFlowExecutionMessage({
      flowId: flow.id,
      priority: 'normal',
      flowData: {
        name: flow.name,
        version: flow.version,
        nodes: flow.nodes,
        connections: flow.connections,
      },
      inputs,
      userId: 'orchestrator',
      triggeredBy: 'api',
    });

    // Aquí se enviaría el mensaje a la cola de ejecución
    // Por ahora solo logeamos
    this.logger.log(
      `Flow execution message created for flow ${id} with execution ID ${executionMessage.executionId}`,
    );

    return { executionId: executionMessage.executionId };
  }

  private validateFlow(flow: Flow): void {
    if (!flow.nodes || flow.nodes.length === 0) {
      throw new BadRequestException('A flow must have at least one node.');
    }

    const nodeIds = new Set(flow.nodes.map((n) => n.id));
    for (const conn of flow.connections) {
      if (!nodeIds.has(conn.sourceId) || !nodeIds.has(conn.targetId)) {
        throw new BadRequestException(
          `Invalid connection: node IDs ${conn.sourceId} or ${conn.targetId} not found.`,
        );
      }
    }
  }
}
