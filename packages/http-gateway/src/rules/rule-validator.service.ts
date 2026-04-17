import { Injectable, Inject } from '@nestjs/common';
import { type Storage } from '@jarvis/storage';
import { createAIProvider, AI_NOT_CONFIGURED_MSG, type AIProvider } from '@jarvis/core';
import { STORAGE_TOKEN } from '../storage.module.js';

const TOOL_OBJECTIVES: Record<string, string> = {
  'refine_requirements': 'Refine raw requirements to be specific, measurable, and complete. Identify ambiguities, missing information, and edge cases.',
  'check_definition_of_ready': 'Evaluate a ticket against Definition of Ready criteria. Determine if a ticket is ready to start work.',
  'generate_user_stories': 'Break down feature descriptions into well-structured, INVEST-compliant user stories.',
  'identify_dependencies': 'Identify technical, functional, and team dependencies in requirements with risk assessment.',
  'jira_get_ticket': 'Retrieve ticket information from Jira.',
  'jira_analyze_ticket': 'Analyze a Jira ticket for quality and completeness.',
  'jira_list_my_tickets': 'List assigned Jira tickets with optional filtering.',
  'jira_add_comment': 'Add a comment to a Jira ticket.',
  'jira_transition_ticket': 'Transition a Jira ticket to a new status.',
  'code_generate': 'Generate code following project stack and conventions.',
  'code_review': 'Review code against project conventions and best practices.',
  'code_generate_tests': 'Generate tests for given code.',
  'code_generate_commit_message': 'Generate a commit message from a diff.',
  'code_debug_error': 'Help debug an error with context.',
  'n8n_list_workflows': 'List workflows from n8n instance.',
  'n8n_trigger_workflow': 'Trigger an n8n workflow with optional data.',
  'n8n_get_execution_status': 'Get the status of an n8n workflow execution.',
};

export interface RuleValidationResult {
  valid: boolean;
  reason: string;
  conflicts: string[];
  suggestion?: string;
}

@Injectable()
export class RuleValidatorService {
  private provider: AIProvider | null;

  constructor(@Inject(STORAGE_TOKEN) private readonly storage: Storage) {
    // Try to load provider from DB first
    const activeConfig = storage.aiConfig.getActive();
    if (activeConfig) {
      this.provider = createAIProvider({
        provider: activeConfig.provider as 'anthropic' | 'ollama' | 'qwen',
        apiKey: activeConfig.api_key || undefined,
        baseUrl: activeConfig.base_url || undefined,
        model: activeConfig.model,
      });
    } else {
      // Backwards compatibility: fall back to env var
      const apiKey = process.env['ANTHROPIC_API_KEY'];
      this.provider = apiKey
        ? createAIProvider({
            provider: 'anthropic',
            apiKey,
            model: process.env['JARVIS_MODEL'] || 'claude-sonnet-4-20250514',
          })
        : null;
    }
  }

  async validate(
    projectId: string,
    category: string,
    rule: string,
    toolName: string | null,
  ): Promise<RuleValidationResult> {
    if (!this.provider || !this.provider.isConfigured()) {
      return {
        valid: true,
        reason: AI_NOT_CONFIGURED_MSG,
        conflicts: [],
      };
    }

    const existingRules = this.storage.rules.list(projectId);
    const projectContext = this.storage.projects.getFullContext(projectId);
    const toolObjective = toolName ? TOOL_OBJECTIVES[toolName] || null : null;

    const systemPrompt = `You are a rule validation system for JARVIS, an AI development agent. Your job is to evaluate whether a new rule is appropriate before it gets stored.

You must validate:
1. The rule does not conflict with or contradict existing rules for this project
2. If the rule is assigned to a specific tool, it must not deviate from that tool's core objective
3. The rule must make sense in the context of the project (sector, stack, conventions)
4. The rule should be actionable — a premise, a way of thinking, or a factual assertion about the project

Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "valid": boolean,
  "reason": "explanation for the user in Spanish",
  "conflicts": ["list of conflicting existing rules, if any"],
  "suggestion": "alternative wording if the rule is invalid, or null if valid"
}`;

    const userMessage = this.buildValidationMessage(
      rule, category, toolName, toolObjective,
      existingRules, projectContext,
    );

    const response = await this.provider.chat({
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1024,
    });

    try {
      return JSON.parse(response.content) as RuleValidationResult;
    } catch {
      return { valid: true, reason: 'Validation passed (parsing fallback)', conflicts: [] };
    }
  }

  private buildValidationMessage(
    rule: string,
    category: string,
    toolName: string | null,
    toolObjective: string | null,
    existingRules: Array<{ category: string; rule: string; tool_name: string | null }>,
    projectContext: { project: { name: string; sector: string | null }; stack: Array<{ layer: string; value: string }> } | undefined,
  ): string {
    const parts: string[] = [];

    parts.push(`## New Rule to Validate`);
    parts.push(`- **Category:** ${category}`);
    parts.push(`- **Rule:** ${rule}`);
    if (toolName) parts.push(`- **Assigned to tool:** ${toolName}`);

    if (toolObjective) {
      parts.push(`\n## Tool Objective (immutable)`);
      parts.push(`The tool "${toolName}" has this fixed objective: ${toolObjective}`);
      parts.push(`The new rule MUST NOT change or deviate from this objective.`);
    }

    if (existingRules.length > 0) {
      parts.push(`\n## Existing Rules for this Project`);
      for (const r of existingRules) {
        const tool = r.tool_name ? ` [tool: ${r.tool_name}]` : '';
        parts.push(`- [${r.category}]${tool} ${r.rule}`);
      }
    }

    if (projectContext) {
      parts.push(`\n## Project Context`);
      parts.push(`- **Name:** ${projectContext.project.name}`);
      if (projectContext.project.sector) parts.push(`- **Sector:** ${projectContext.project.sector}`);
      if (projectContext.stack.length > 0) {
        parts.push(`- **Stack:** ${projectContext.stack.map(s => `${s.layer}: ${s.value}`).join(', ')}`);
      }
    }

    parts.push(`\n## Validation Criteria`);
    parts.push(`1. Does this rule conflict with any existing rule?`);
    parts.push(`2. Does this rule stay within the tool's objective? (if assigned to a tool)`);
    parts.push(`3. Does this rule make sense for this project's context?`);
    parts.push(`4. Is this rule actionable (a premise, way of thinking, or factual assertion)?`);

    return parts.join('\n');
  }
}
