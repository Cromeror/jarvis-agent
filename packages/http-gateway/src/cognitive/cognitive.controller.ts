import { Controller, Get, Inject } from '@nestjs/common';
import { type Storage } from '@jarvis/storage';
import { STORAGE_TOKEN } from '../storage.module.js';

@Controller('api/cognitive')
export class CognitiveController {
  constructor(
    @Inject(STORAGE_TOKEN) private readonly storage: Storage,
  ) {}

  @Get()
  getActive() {
    const cognitive = this.storage.cognitive.getActive();
    return { data: cognitive ?? null };
  }
}
