import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type Storage } from '@jarvis/storage';
import { STORAGE_TOKEN } from '../storage.module.js';

@Controller('api/sessions')
export class SessionsController {
  constructor(
    @Inject(STORAGE_TOKEN) private readonly storage: Storage,
  ) {}

  @Get()
  list(@Query('project') projectId?: string) {
    return { data: this.storage.sessions.list(projectId) };
  }
}
