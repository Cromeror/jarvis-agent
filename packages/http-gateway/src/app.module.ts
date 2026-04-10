import { Module } from '@nestjs/common';
import { StorageModule } from './storage.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { CognitiveModule } from './cognitive/cognitive.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    StorageModule,
    ProjectsModule,
    CognitiveModule,
    SessionsModule,
    HealthModule,
  ],
})
export class AppModule {}
