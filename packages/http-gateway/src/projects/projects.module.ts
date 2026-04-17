import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { RulesModule } from '../rules/rules.module.js';

@Module({
  imports: [RulesModule],
  controllers: [ProjectsController],
})
export class ProjectsModule {}
