import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Inject,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type Storage } from '@jarvis/storage';
import { STORAGE_TOKEN } from '../storage.module.js';
import { RuleValidatorService } from '../rules/rule-validator.service.js';

interface CreateProjectBody {
  id: string;
  name: string;
  sector?: string;
  description?: string;
}

interface AddRuleBody {
  category: string;
  rule: string;
  priority?: number;
  tool_name?: string;
}

interface SetStackBody {
  layer: string;
  value: string;
  notes?: string;
}

interface SetIntegrationBody {
  service: string;
  config: Record<string, unknown>;
}

@Controller('api/projects')
export class ProjectsController {
  constructor(
    @Inject(STORAGE_TOKEN) private readonly storage: Storage,
    private readonly ruleValidator: RuleValidatorService,
  ) {}

  private assertProjectExists(id: string): void {
    if (!this.storage.projects.get(id)) {
      throw new NotFoundException(`Project '${id}' not found`);
    }
  }

  @Get()
  list() {
    return { data: this.storage.projects.list() };
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    const context = this.storage.projects.getFullContext(id);
    if (!context) {
      throw new NotFoundException(`Project '${id}' not found`);
    }
    return { data: context };
  }

  @Post()
  create(@Body() body: CreateProjectBody) {
    const project = this.storage.projects.create(body);
    return { data: project };
  }

  // --- Rules ---

  @Get(':id/rules')
  listRules(
    @Param('id') id: string,
    @Query('category') category?: string,
  ) {
    this.assertProjectExists(id);
    return { data: this.storage.rules.list(id, category) };
  }

  @Post(':id/rules')
  async addRule(@Param('id') id: string, @Body() body: AddRuleBody) {
    this.assertProjectExists(id);

    const toolName = body.tool_name ?? null;
    const validation = await this.ruleValidator.validate(
      id, body.category, body.rule, toolName,
    );

    if (!validation.valid) {
      throw new UnprocessableEntityException({
        message: 'Rule validation failed',
        reason: validation.reason,
        conflicts: validation.conflicts,
        suggestion: validation.suggestion ?? null,
      });
    }

    const rule = this.storage.rules.add(id, body.category, body.rule, body.priority, toolName);
    return { data: rule, validation: { reason: validation.reason } };
  }

  @Delete('rules/:ruleId')
  removeRule(@Param('ruleId') ruleId: string) {
    const numId = parseInt(ruleId, 10);
    this.storage.rules.remove(numId);
    return { data: { removed: numId } };
  }

  // --- Stack ---

  @Get(':id/stack')
  listStack(@Param('id') id: string) {
    this.assertProjectExists(id);
    return { data: this.storage.stack.list(id) };
  }

  @Post(':id/stack')
  setStack(@Param('id') id: string, @Body() body: SetStackBody) {
    this.assertProjectExists(id);
    const entry = this.storage.stack.set(id, body.layer, body.value, body.notes);
    return { data: entry };
  }

  @Delete('stack/:stackId')
  removeStack(@Param('stackId') stackId: string) {
    const numId = parseInt(stackId, 10);
    this.storage.stack.remove(numId);
    return { data: { removed: numId } };
  }

  // --- Integrations ---

  @Get(':id/integrations')
  listIntegrations(@Param('id') id: string) {
    this.assertProjectExists(id);
    return { data: this.storage.integrations.list(id) };
  }

  @Post(':id/integrations')
  setIntegration(@Param('id') id: string, @Body() body: SetIntegrationBody) {
    this.assertProjectExists(id);
    const integration = this.storage.integrations.set(
      id,
      body.service,
      body.config,
    );
    return { data: integration };
  }

  @Delete(':id/integrations/:service')
  removeIntegration(@Param('id') id: string, @Param('service') service: string) {
    this.assertProjectExists(id);
    this.storage.integrations.remove(id, service);
    return { data: { removed: { project_id: id, service } } };
  }

  // --- Knowledge ---

  @Get(':id/knowledge')
  searchKnowledge(
    @Param('id') id: string,
    @Query('q') query?: string,
  ) {
    this.assertProjectExists(id);
    return { data: this.storage.knowledge.search(id, query ?? '') };
  }
}
