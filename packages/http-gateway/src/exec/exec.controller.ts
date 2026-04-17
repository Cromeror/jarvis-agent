import { Body, Controller, Post } from '@nestjs/common';
import { ExecService, type JiraExecRequest } from './exec.service.js';

@Controller('api/exec')
export class ExecController {
  constructor(private readonly execService: ExecService) {}

  @Post('jira')
  jira(@Body() body: JiraExecRequest) {
    return this.execService.executeJira(body);
  }
}
