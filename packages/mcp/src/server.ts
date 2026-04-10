import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createStorage } from '@jarvis/storage';
import { ToolRegistry } from '@jarvis/core';
import { JarvisAgent } from '@jarvis/agent';

import { createJiraSkill } from '@jarvis/skills-jira';
import { createRefineSkill } from '@jarvis/skills-refine';
import { createCodeSkill } from '@jarvis/skills-code';
import { createN8nSkill } from '@jarvis/skills-n8n';

export async function startServer(): Promise<void> {
  const dbPath = process.env.JARVIS_DB_PATH || './data/jarvis.db';
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
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
        model: process.env.JARVIS_MODEL || 'claude-sonnet-4-20250514',
        maxTokens: 8192,
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
