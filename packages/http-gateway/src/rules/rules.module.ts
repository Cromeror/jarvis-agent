import { Module } from '@nestjs/common';
import { RuleValidatorService } from './rule-validator.service.js';

@Module({
  providers: [RuleValidatorService],
  exports: [RuleValidatorService],
})
export class RulesModule {}
