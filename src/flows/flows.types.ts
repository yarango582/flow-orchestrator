import { FlowStatus } from './dto';

export interface Flow {
  id: string;
  name: string;
  description?: string;
  status: FlowStatus;
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
  createdAt: Date;
  updatedAt: Date;
}
