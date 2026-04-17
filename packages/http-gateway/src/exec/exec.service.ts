import { Injectable, BadRequestException } from '@nestjs/common';
import { execSync } from 'node:child_process';

export interface JiraExecRequest {
  site: string;
  email: string;
  action: 'get_ticket' | 'list_tickets' | 'add_comment' | 'transition';
  params: Record<string, unknown>;
}

export interface ExecResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

@Injectable()
export class ExecService {
  executeJira(req: JiraExecRequest): ExecResult {
    const start = Date.now();
    try {
      // Step 1: switch account
      this.runCommand(
        `acli jira auth switch --site ${this.escape(req.site)} --email ${this.escape(req.email)}`,
      );

      // Step 2: execute the requested action
      const cmd = this.buildCommand(req);
      const output = this.runCommand(cmd);

      return {
        success: true,
        output,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: '',
        error: message,
        durationMs: Date.now() - start,
      };
    }
  }

  private buildCommand(req: JiraExecRequest): string {
    const { action, params } = req;
    switch (action) {
      case 'get_ticket': {
        const ticketId = this.requireParam(params, 'ticket_id');
        return `acli jira workitem view ${this.escape(ticketId)}`;
      }
      case 'list_tickets': {
        const jql = (params['jql'] as string) || 'assignee = currentUser() ORDER BY updated DESC';
        return `acli jira workitem search --jql ${this.escape(jql)}`;
      }
      case 'add_comment': {
        const ticketId = this.requireParam(params, 'ticket_id');
        const comment = this.requireParam(params, 'comment');
        return `acli jira workitem comment ${this.escape(ticketId)} --body ${this.escape(comment)}`;
      }
      case 'transition': {
        const ticketId = this.requireParam(params, 'ticket_id');
        const transition = this.requireParam(params, 'transition');
        return `acli jira workitem transition ${this.escape(ticketId)} --transition ${this.escape(transition)}`;
      }
      default:
        throw new BadRequestException(`Unknown action: ${action}`);
    }
  }

  private requireParam(params: Record<string, unknown>, key: string): string {
    const value = params[key];
    if (typeof value !== 'string' || !value) {
      throw new BadRequestException(`Missing required param: ${key}`);
    }
    return value;
  }

  private escape(s: string): string {
    // Quote and escape single quotes for shell safety
    return `'${s.replace(/'/g, "'\\''")}'`;
  }

  private runCommand(cmd: string): string {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
  }
}
