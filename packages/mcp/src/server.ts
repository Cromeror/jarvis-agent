import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { createStorage } from '@jarvis/storage';
import { ToolRegistry } from '@jarvis/core';
import { JarvisAgent } from '@jarvis/agent';

import { createJiraSkill } from '@jarvis/tools-jira';
import { createRefineSkill } from '@jarvis/tools-refine';
import { createCodeSkill } from '@jarvis/tools-code';
import { createN8nSkill } from '@jarvis/tools-n8n';

// Mirror of resolveJarvisHome() from @jarvis/cli — the MCP package cannot depend
// on the CLI package, so we duplicate this small function. Keep both in sync.
function resolveJarvisHome(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || resolve(homedir(), 'AppData', 'Roaming');
    return resolve(appData, 'jarvis');
  }
  return resolve(homedir(), '.jarvis');
}

export async function startServer(): Promise<void> {
  const jarvisHome = resolveJarvisHome();
  if (!existsSync(jarvisHome)) {
    mkdirSync(jarvisHome, { recursive: true });
  }
  const dbPath = resolve(jarvisHome, 'jarvis.db');
  const storage = createStorage(dbPath);

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createJiraSkill(storage));
  toolRegistry.register(createRefineSkill(storage));
  toolRegistry.register(createCodeSkill(storage));
  toolRegistry.register(createN8nSkill(storage));

  const server = new McpServer({
    name: 'jarvis',
    version: '0.0.1',
  });

  server.tool(
    'jarvis_chat',
    'Send a message to JARVIS agent and get a response',
    {
      message: z.string().describe('The message to send to JARVIS'),
      project_id: z.string().optional().describe('Optional project context'),
      session_id: z.string().optional().describe('Optional session ID to resume'),
    },
    async ({ message, project_id, session_id }) => {
      const agent = new JarvisAgent(storage, toolRegistry, {
        dbPath,
        // Backwards compat: pass env var so JarvisAgent can fall back if no DB config
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
        model: process.env.JARVIS_MODEL || 'claude-sonnet-4-20250514',
        maxTokens: parseInt(process.env.JARVIS_MAX_TOKENS || '8192', 10),
      });

      let sid = session_id;
      if (!sid) {
        const session = await agent.startSession(project_id);
        sid = session.id;
      }

      const response = await agent.run(message, sid);
      return { content: [{ type: 'text' as const, text: response }] };
    }
  );

  server.tool(
    'jarvis_list_projects',
    'List all JARVIS projects',
    {},
    async () => {
      const projects = storage.projects.list();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(projects, null, 2),
        }],
      };
    }
  );

  server.tool(
    'jarvis_project_context',
    'Get full context for a JARVIS project',
    {
      project_id: z.string().describe('The project ID'),
    },
    async ({ project_id }) => {
      const ctx = storage.projects.getFullContext(project_id);
      return {
        content: [{
          type: 'text' as const,
          text: ctx ? JSON.stringify(ctx, null, 2) : 'Project not found',
        }],
      };
    }
  );

  server.tool(
    'jarvis_run_tool',
    'Invoke a JARVIS tool directly (bypasses the AI agent loop). Use this to execute a specific tool like jira_analyze_ticket with known inputs.',
    {
      tool_name: z.string().describe('The tool to invoke (e.g. jira_analyze_ticket, jira_get_ticket)'),
      input: z.record(z.unknown()).describe('The input object for the tool (e.g. { ticket_id: "LXM-473", project_id: "lx" })'),
    },
    async ({ tool_name, input }) => {
      try {
        const result = await toolRegistry.execute(tool_name, input as Record<string, unknown>);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
