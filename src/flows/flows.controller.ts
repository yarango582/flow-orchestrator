import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { FlowsService } from './flows.service';
import { CreateFlowDto, UpdateFlowDto, FlowQueryDto } from './dto';

@ApiTags('Flows')
@Controller('flows')
export class FlowsController {
  constructor(private readonly flowsService: FlowsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new flow' })
  @ApiResponse({ status: 201, description: 'Flow created successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid input data.' })
  async createFlow(@Body(new ValidationPipe()) createFlowDto: CreateFlowDto) {
    return this.flowsService.createFlow(createFlowDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all flows with pagination and filtering' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Flows retrieved successfully.' })
  async getFlows(@Query() query: FlowQueryDto) {
    return this.flowsService.getFlows(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a flow by its ID' })
  @ApiParam({ name: 'id', description: 'Flow UUID' })
  @ApiResponse({ status: 200, description: 'Flow found.' })
  @ApiResponse({ status: 404, description: 'Flow not found.' })
  async getFlowById(@Param('id', ParseUUIDPipe) id: string) {
    return this.flowsService.getFlowById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing flow' })
  @ApiParam({ name: 'id', description: 'Flow UUID' })
  @ApiBody({ type: UpdateFlowDto })
  @ApiResponse({ status: 200, description: 'Flow updated successfully.' })
  @ApiResponse({ status: 404, description: 'Flow not found.' })
  async updateFlow(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ValidationPipe()) updateFlowDto: UpdateFlowDto,
  ) {
    return this.flowsService.updateFlow(id, updateFlowDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a flow' })
  @ApiParam({ name: 'id', description: 'Flow UUID' })
  @ApiResponse({ status: 204, description: 'Flow deleted successfully.' })
  @ApiResponse({ status: 404, description: 'Flow not found.' })
  async deleteFlow(@Param('id', ParseUUIDPipe) id: string) {
    return this.flowsService.deleteFlow(id);
  }

  @Post(':id/execute')
  @ApiOperation({ summary: 'Execute a flow' })
  @ApiParam({ name: 'id', description: 'Flow UUID' })
  @ApiBody({ required: false, schema: { type: 'object' } })
  @ApiResponse({ status: 202, description: 'Flow execution accepted.' })
  @ApiResponse({ status: 404, description: 'Flow not found.' })
  @ApiResponse({ status: 400, description: 'Flow is not active.' })
  async executeFlow(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() inputs: Record<string, any> = {},
  ) {
    return this.flowsService.executeFlow(id, inputs);
  }
}
