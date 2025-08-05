import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum FlowStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

// DTO for FlowNode
export class FlowNodeDto {
  @ApiProperty({ description: 'Node unique identifier' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Node type from node-core registry' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: 'Node configuration', type: 'object' })
  @IsObject()
  config: Record<string, any>;

  @ApiPropertyOptional({ description: 'Node position in canvas' })
  @IsOptional()
  @IsObject()
  position?: { x: number; y: number };
}

// DTO for FlowConnection
export class FlowConnectionDto {
  @ApiProperty({ description: 'Source node ID' })
  @IsString()
  @IsNotEmpty()
  sourceId: string;

  @ApiProperty({ description: 'Target node ID' })
  @IsString()
  @IsNotEmpty()
  targetId: string;

  @ApiPropertyOptional({ description: 'Source port' })
  @IsOptional()
  @IsString()
  sourcePort?: string;

  @ApiPropertyOptional({ description: 'Target port' })
  @IsOptional()
  @IsString()
  targetPort?: string;
}

export class CreateFlowDto {
  @ApiProperty({ description: 'Flow name', example: 'Data Processing Flow' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Flow description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Flow status', enum: FlowStatus })
  @IsEnum(FlowStatus)
  status: FlowStatus;

  @ApiProperty({ description: 'Flow nodes', type: [FlowNodeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowNodeDto)
  nodes: FlowNodeDto[];

  @ApiProperty({ description: 'Flow connections', type: [FlowConnectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowConnectionDto)
  connections: FlowConnectionDto[];
}
