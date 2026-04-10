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
} from '@nestjs/common';
import { type Storage } from '@jarvis/storage';
import { STORAGE_TOKEN } from '../storage.module.js';

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
}

interface SetStackBody {
  layer: string;
  value: string;
  notes?: string;
}

interface SetIntegrationBody {
  type: string;
  key: string;
  value: string;
  notes?: string;
}

@Controller('api/projects')
export class ProjectsController {
  constructor(
    @Inject(STORAGE_TOKEN) private readonly storage: Storage,
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
  addRule(@Param('id') id: string, @Body() body: AddRuleBody) {
    this.assertProjectExists(id);
    const rule = this.storage.rules.add(id, body.category, body.rule, body.priority);
    return { data: rule };
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
      body.type,
      body.key,
      body.value,
      body.notes,
    );
    return { data: integration };
  }

  @Delete('integrations/:integrationId')
  removeIntegration(@Param('integrationId') integrationId: string) {
    const numId = parseInt(integrationId, 10);
    this.storage.integrations.remove(numId);
    return { data: { removed: numId } };
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
