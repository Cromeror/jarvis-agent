import { Module } from '@nestjs/common';
import { ExecController } from './exec.controller.js';
import { ExecService } from './exec.service.js';

@Module({
  controllers: [ExecController],
  providers: [ExecService],
})
export class ExecModule {}
