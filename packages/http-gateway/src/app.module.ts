import { Module } from '@nestjs/common';
import { StorageModule } from './storage.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { CognitiveModule } from './cognitive/cognitive.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { HealthModule } from './health/health.module.js';
import { RulesModule } from './rules/rules.module.js';
import { ExecModule } from './exec/exec.module.js';

@Module({
  imports: [
    StorageModule,
    ProjectsModule,
    CognitiveModule,
    SessionsModule,
    HealthModule,
    RulesModule,
    ExecModule,
  ],
})
export class AppModule {}
