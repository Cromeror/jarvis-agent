import type { Skill, ToolDefinition } from '@jarvis/core';
import { resolveRulesForTool } from '@jarvis/core';
import type { Storage } from '@jarvis/storage';

const tools: ToolDefinition[] = [
  {
    name: 'code_generate',
    description: 'Generates code using project stack and conventions as context',
    input_schema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'What code should be generated (feature, function, module, etc.)',
        },
        language: {
          type: 'string',
          description: 'Programming language (e.g. TypeScript, Python, Go)',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID to load stack and conventions',
        },
      },
      required: ['description'],
    },
  },
  {
    name: 'code_review',
    description: 'Reviews code against project conventions and best practices',
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The code to review',
        },
        language: {
          type: 'string',
          description: 'Programming language of the code',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID to load project-specific conventions',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'code_generate_tests',
    description: 'Generates tests for a given piece of code',
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The source code to generate tests for',
        },
        language: {
          type: 'string',
          description: 'Programming language of the code',
        },
        framework: {
          type: 'string',
          description: 'Testing framework to use (e.g. vitest, jest, pytest, go test)',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID to load project-specific testing rules',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'code_generate_commit_message',
    description: 'Generates a conventional commit message from a git diff',
    input_schema: {
      type: 'object',
      properties: {
        diff: {
          type: 'string',
          description: 'The git diff output to generate a commit message for',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID to load project-specific commit conventions',
        },
      },
      required: ['diff'],
    },
  },
  {
    name: 'code_debug_error',
    description: 'Helps debug an error by analyzing it with project context',
    input_schema: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          description: 'The error message or stack trace',
        },
        context: {
          type: 'string',
          description: 'Optional surrounding code or additional context',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID to load project-specific debugging context',
        },
      },
      required: ['error'],
    },
  },
];

function formatStack(stack: { layer: string; value: string; notes: string | null }[]): string {
  if (stack.length === 0) return '(No stack information available)';
  return stack.map((s) => `- **${s.layer}**: ${s.value}${s.notes ? ` (${s.notes})` : ''}`).join('\n');
}

export function createCodeSkill(storage: Storage): Skill {
  async function execute(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    switch (toolName) {
      case 'code_generate': {
        const description = input['description'] as string;
        const language = input['language'] as string | undefined;
        const projectId = input['project_id'] as string | undefined;

        let stackSection = '';

        if (projectId) {
          const stack = storage.stack.list(projectId);
          stackSection = [
            '### Project Stack',
            formatStack(stack),
            '',
          ].join('\n');
        }

        const conventionsSection = resolveRulesForTool(storage, projectId, 'code_generate', 'code_conventions');

        return [
          '## Code Generation Request',
          '',
          '### What to Generate',
          description,
          '',
          language ? `### Language\n${language}\n` : '',
          stackSection,
          conventionsSection,
          '### Instructions',
          'Generate the requested code following these guidelines:',
          '1. Follow the project stack and conventions listed above.',
          '2. Write clean, readable, and well-commented code.',
          '3. Handle errors gracefully with appropriate error types.',
          '4. Follow SOLID principles and keep functions small and focused.',
          '5. Include type annotations where applicable.',
          '6. Add brief inline comments for non-obvious logic.',
          '7. After generating, describe what was created and how to use it.',
        ].filter(Boolean).join('\n');
      }

      case 'code_review': {
        const code = input['code'] as string;
        const language = input['language'] as string | undefined;
        const projectId = input['project_id'] as string | undefined;

        const conventionsSection = resolveRulesForTool(storage, projectId, 'code_review', 'code_conventions');

        return [
          '## Code Review',
          '',
          language ? `### Language: ${language}\n` : '',
          '### Code Under Review',
          '```',
          code,
          '```',
          '',
          conventionsSection,
          '### Review Checklist',
          'Evaluate the code above against each category and provide specific feedback:',
          '',
          '#### Correctness',
          '- Does the code do what it claims to do?',
          '- Are there any bugs, off-by-one errors, or logic flaws?',
          '- Are edge cases handled?',
          '',
          '#### Security',
          '- Are there any injection vulnerabilities?',
          '- Is sensitive data handled securely?',
          '- Are inputs validated and sanitized?',
          '',
          '#### Performance',
          '- Are there obvious performance issues (N+1 queries, unnecessary loops, etc.)?',
          '- Is memory usage appropriate?',
          '',
          '#### Maintainability',
          '- Is the code readable and well-structured?',
          '- Are functions and variables named clearly?',
          '- Is the code DRY (Don\'t Repeat Yourself)?',
          '',
          '#### Test Coverage',
          '- Are there tests for this code?',
          '- Are edge cases tested?',
          '',
          '### Summary',
          'Provide: overall rating (1-5), list of issues (critical/warning/suggestion), and recommended changes.',
        ].filter(Boolean).join('\n');
      }

      case 'code_generate_tests': {
        const code = input['code'] as string;
        const language = input['language'] as string | undefined;
        const framework = input['framework'] as string | undefined;
        const projectId = input['project_id'] as string | undefined;

        const rulesSection = resolveRulesForTool(storage, projectId, 'code_generate_tests', 'testing');

        return [
          '## Test Generation Request',
          '',
          language ? `### Language: ${language}` : '',
          framework ? `### Testing Framework: ${framework}` : '',
          '',
          '### Source Code',
          '```',
          code,
          '```',
          '',
          rulesSection,
          '### Instructions',
          'Generate comprehensive tests for the code above:',
          '',
          '1. **Unit Tests** — Test each function/method in isolation.',
          '2. **Happy Path** — Test the expected behavior with valid inputs.',
          '3. **Edge Cases** — Test boundary conditions and unusual inputs.',
          '4. **Error Cases** — Test that errors are thrown/returned correctly for invalid inputs.',
          '5. **Mocking** — Mock external dependencies (databases, APIs, file system) as needed.',
          '',
          'Structure:',
          '- Group related tests with describe blocks',
          '- Use clear, descriptive test names: "should [expected behavior] when [condition]"',
          '- Follow Arrange/Act/Assert (AAA) pattern',
          '- Aim for high coverage of all code branches',
        ].filter(Boolean).join('\n');
      }

      case 'code_generate_commit_message': {
        const diff = input['diff'] as string;
        const projectId = input['project_id'] as string | undefined;

        const rulesSection = resolveRulesForTool(storage, projectId, 'code_generate_commit_message', 'git');

        return [
          '## Commit Message Generation',
          '',
          '### Git Diff',
          '```diff',
          diff,
          '```',
          '',
          rulesSection,
          '### Instructions',
          'Generate a conventional commit message for the diff above.',
          '',
          'Follow the Conventional Commits specification:',
          '```',
          '<type>(<scope>): <short summary>',
          '',
          '[optional body]',
          '',
          '[optional footer]',
          '```',
          '',
          'Types: feat, fix, docs, style, refactor, perf, test, chore, ci, build',
          '',
          'Rules:',
          '- Summary line: max 72 characters, imperative mood, no period at end',
          '- Body: explain WHY not WHAT, wrap at 72 characters',
          '- Footer: reference issues with "Closes #123" or "Refs #456"',
          '- Breaking changes: add "BREAKING CHANGE:" in footer',
          '',
          'Provide the commit message and briefly explain the choice of type and scope.',
        ].join('\n');
      }

      case 'code_debug_error': {
        const error = input['error'] as string;
        const context = input['context'] as string | undefined;
        const projectId = input['project_id'] as string | undefined;

        const rulesSection = resolveRulesForTool(storage, projectId, 'code_debug_error', 'debugging');

        return [
          '## Error Debugging',
          '',
          '### Error / Stack Trace',
          '```',
          error,
          '```',
          '',
          context ? ['### Additional Context', '```', context, '```', ''].join('\n') : '',
          rulesSection,
          '### Debugging Instructions',
          'Analyze the error above and provide:',
          '',
          '1. **Root Cause** — What is causing this error?',
          '2. **Explanation** — Why does this happen?',
          '3. **Solution** — Step-by-step fix with code examples.',
          '4. **Prevention** — How to avoid this error in the future.',
          '',
          'Consider:',
          '- Type errors vs runtime errors vs logic errors',
          '- Environmental issues (missing env vars, wrong versions, missing dependencies)',
          '- Common pitfalls for this language/framework',
          '- Whether the error message is accurate or misleading',
        ].filter(Boolean).join('\n');
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  }

  return {
    name: 'code',
    description:
      'Code skill for generating, reviewing, testing, and debugging code using project context',
    tools,
    execute,
  };
}
