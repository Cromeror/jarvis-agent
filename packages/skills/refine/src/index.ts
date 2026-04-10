import type { Skill, ToolDefinition } from '@jarvis/core';
import type { Storage } from '@jarvis/storage';

const tools: ToolDefinition[] = [
  {
    name: 'refine_requirements',
    description:
      'Refines raw requirements using project-specific rules and conventions',
    input_schema: {
      type: 'object',
      properties: {
        requirements: {
          type: 'string',
          description: 'The raw requirements text to refine',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID to load project-specific rules',
        },
      },
      required: ['requirements'],
    },
  },
  {
    name: 'check_definition_of_ready',
    description:
      'Checks a ticket description against the Definition of Ready rules for a project',
    input_schema: {
      type: 'object',
      properties: {
        ticket_description: {
          type: 'string',
          description: 'The ticket description to evaluate',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID to load DoR rules',
        },
      },
      required: ['ticket_description'],
    },
  },
  {
    name: 'generate_user_stories',
    description:
      'Generates well-structured user stories from a feature description',
    input_schema: {
      type: 'object',
      properties: {
        feature_description: {
          type: 'string',
          description: 'The feature or epic description to break down into user stories',
        },
      },
      required: ['feature_description'],
    },
  },
  {
    name: 'identify_dependencies',
    description: 'Identifies technical and functional dependencies in a set of requirements',
    input_schema: {
      type: 'object',
      properties: {
        requirements: {
          type: 'string',
          description: 'The requirements text to analyze for dependencies',
        },
      },
      required: ['requirements'],
    },
  },
];

function formatRules(rules: { category: string; rule: string; priority: number }[]): string {
  if (rules.length === 0) return '(No project-specific rules found)';
  return rules.map((r) => `- [${r.category}] ${r.rule}`).join('\n');
}

export function createRefineSkill(storage: Storage): Skill {
  async function execute(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    switch (toolName) {
      case 'refine_requirements': {
        const requirements = input['requirements'] as string;
        const projectId = input['project_id'] as string | undefined;

        let rulesSection = '';
        if (projectId) {
          const rules = storage.rules.list(projectId, 'refinement');
          const allRules = rules.length > 0
            ? rules
            : storage.rules.list(projectId);
          rulesSection = [
            '### Project Rules to Apply',
            formatRules(allRules),
            '',
          ].join('\n');
        }

        return [
          '## Requirements Refinement Analysis',
          '',
          '### Input Requirements',
          requirements,
          '',
          rulesSection,
          '### Refinement Instructions',
          'Please analyze the requirements above and provide:',
          '',
          '1. **Clarified Requirements** — Rewrite each requirement to be specific, measurable, achievable, relevant, and time-bound (SMART).',
          '2. **Ambiguities Identified** — List any vague or contradictory statements that need clarification.',
          '3. **Missing Information** — Identify what information is missing to fully specify the requirements.',
          '4. **Edge Cases** — Highlight potential edge cases that should be addressed.',
          '5. **Acceptance Criteria** — For each refined requirement, suggest clear acceptance criteria.',
        ].join('\n');
      }

      case 'check_definition_of_ready': {
        const ticketDescription = input['ticket_description'] as string;
        const projectId = input['project_id'] as string | undefined;

        let dorRules: string[] = [];
        if (projectId) {
          const rules = storage.rules.list(projectId, 'definition_of_ready');
          dorRules = rules.map((r) => `- ${r.rule}`);
        }

        const defaultDorCriteria = [
          '- Clear and concise summary that describes the work',
          '- Detailed description explaining the problem or feature',
          '- Specific, testable acceptance criteria',
          '- Story point estimate provided',
          '- Priority level set',
          '- No unresolved blocking dependencies',
          '- Assigned to the correct component/team',
          '- Reviewed and approved by product owner',
        ];

        const criteria = dorRules.length > 0 ? dorRules : defaultDorCriteria;

        return [
          '## Definition of Ready Check',
          '',
          '### Ticket Description',
          ticketDescription,
          '',
          '### DoR Criteria to Evaluate',
          criteria.join('\n'),
          '',
          '### Instructions',
          'For each criterion above, determine if the ticket description satisfies it.',
          'Respond with:',
          '- ✅ PASS — criterion is clearly met',
          '- ❌ FAIL — criterion is not met (explain what is missing)',
          '- ⚠️ PARTIAL — criterion is partially met (explain what needs improvement)',
          '',
          'Conclude with an overall **READY** or **NOT READY** verdict and a list of required changes.',
        ].join('\n');
      }

      case 'generate_user_stories': {
        const featureDescription = input['feature_description'] as string;

        return [
          '## User Story Generation',
          '',
          '### Feature Description',
          featureDescription,
          '',
          '### Instructions',
          'Break down the feature description into individual user stories following the standard format:',
          '',
          '**As a** [type of user], **I want** [goal], **so that** [benefit].',
          '',
          'For each user story, also provide:',
          '- **Acceptance Criteria** (Given/When/Then format)',
          '- **Story Points** (estimate: 1, 2, 3, 5, 8, 13)',
          '- **Priority** (Must Have / Should Have / Could Have / Won\'t Have)',
          '- **Dependencies** (other stories this depends on)',
          '',
          'Aim for stories that are:',
          '- **Independent** — can be developed and released independently',
          '- **Negotiable** — details can be discussed',
          '- **Valuable** — delivers value to the end user',
          '- **Estimable** — team can estimate the effort',
          '- **Small** — fits within a sprint',
          '- **Testable** — has clear acceptance criteria',
        ].join('\n');
      }

      case 'identify_dependencies': {
        const requirements = input['requirements'] as string;

        return [
          '## Dependency Analysis',
          '',
          '### Requirements',
          requirements,
          '',
          '### Instructions',
          'Analyze the requirements above and identify all dependencies. Categorize them as:',
          '',
          '#### Technical Dependencies',
          '- External services or APIs required',
          '- Libraries, frameworks, or tools needed',
          '- Infrastructure or platform requirements',
          '- Database schema changes',
          '',
          '#### Functional Dependencies',
          '- Features or capabilities that must exist before this can be implemented',
          '- Data that must be available or migrated',
          '- Business processes that must be in place',
          '',
          '#### Team Dependencies',
          '- Other teams that need to deliver work first',
          '- Subject matter experts or approvals required',
          '',
          '#### Risk Assessment',
          'For each dependency, assess:',
          '- **Impact**: High / Medium / Low (what happens if this is not resolved)',
          '- **Likelihood**: High / Medium / Low (chance the dependency causes a delay)',
          '- **Mitigation**: Suggested action to address the dependency',
        ].join('\n');
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  }

  return {
    name: 'refine',
    description:
      'Refinement skill for analyzing and improving requirements, checking Definition of Ready, generating user stories, and identifying dependencies',
    tools,
    execute,
  };
}
