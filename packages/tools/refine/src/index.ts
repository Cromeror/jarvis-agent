import type { Skill, ToolDefinition } from '@jarvis/core';
import { resolveRulesForTool } from '@jarvis/core';
import type { Storage } from '@jarvis/storage';

const tools: ToolDefinition[] = [
  {
    name: 'refine_requirements',
    description:
      'Refina requerimientos crudos contra reglas del proyecto. Para iterar: pasá `thread_id` (UUID) y opcionalmente `instructions` con las correcciones del user y/o `previous_output` con el texto a re-refinar. Si no pasás `previous_output`, el tool carga automáticamente el último output guardado del hilo. Si omitís `thread_id`, el tool genera uno nuevo y lo incluye en un header HTML (`<!-- refine:meta thread_id: … iteration: … -->`) al principio de la respuesta — extraelo para llamadas siguientes. Este tool NO persiste: después de mostrar el resultado al user y obtener aprobación, llamá `refine_save_iteration` con `thread_id` + `output`. Cuando el user confirme que está listo, llamá `refine_finalize`.',
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
        thread_id: {
          type: 'string',
          description: 'Optional thread ID for iterative refinement. If provided, the tool loads the latest saved output as context.',
        },
        instructions: {
          type: 'string',
          description: 'Optional correction instructions from the user for this iteration.',
        },
        previous_output: {
          type: 'string',
          description: 'Optional explicit previous output to use as context, overriding what is stored in the DB.',
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
        project_id: {
          type: 'string',
          description: 'Optional project ID to load project-specific rules',
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
        project_id: {
          type: 'string',
          description: 'Optional project ID to load project-specific rules',
        },
      },
      required: ['requirements'],
    },
  },
  {
    name: 'refine_save_iteration',
    description:
      'Persiste el output de una iteración de refinamiento en el hilo indicado. Llamar después de mostrar el resultado de `refine_requirements` al user y obtener aprobación. Lanza error si el hilo ya fue finalizado.',
    input_schema: {
      type: 'object',
      properties: {
        thread_id: {
          type: 'string',
          description: 'Thread ID to save the iteration under',
        },
        output: {
          type: 'string',
          description: 'The refined output text to persist',
        },
        instructions: {
          type: 'string',
          description: 'Optional correction instructions used in this iteration',
        },
        requirements: {
          type: 'string',
          description: 'Original requirements (only needed for the first iteration)',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID',
        },
      },
      required: ['thread_id', 'output'],
    },
  },
  {
    name: 'refine_list_iterations',
    description:
      'Lista todas las iteraciones de un hilo de refinamiento ordenadas por número de iteración ascendente. Devuelve lista vacía si el hilo no existe.',
    input_schema: {
      type: 'object',
      properties: {
        thread_id: {
          type: 'string',
          description: 'Thread ID to list iterations for',
        },
      },
      required: ['thread_id'],
    },
  },
  {
    name: 'refine_get_latest',
    description:
      'Devuelve la iteración más reciente de un hilo de refinamiento. Devuelve null si el hilo no existe.',
    input_schema: {
      type: 'object',
      properties: {
        thread_id: {
          type: 'string',
          description: 'Thread ID to get the latest iteration for',
        },
      },
      required: ['thread_id'],
    },
  },
  {
    name: 'refine_finalize',
    description:
      'Finaliza un hilo de refinamiento marcando todas sus iteraciones como `final`. Después de finalizar, no se pueden agregar más iteraciones. Idempotente si el hilo ya está finalizado.',
    input_schema: {
      type: 'object',
      properties: {
        thread_id: {
          type: 'string',
          description: 'Thread ID to finalize',
        },
      },
      required: ['thread_id'],
    },
  },
];

export function createRefineSkill(storage: Storage): Skill {
  async function execute(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    switch (toolName) {
      case 'refine_requirements': {
        const requirements = input['requirements'] as string;
        const projectId = input['project_id'] as string | undefined;

        // Normalize empty strings to undefined (spec §5)
        const rawThreadId = input['thread_id'] as string | undefined;
        const rawInstructions = input['instructions'] as string | undefined;
        const explicitPrevOutput = input['previous_output'] as string | undefined;

        const threadId = rawThreadId && rawThreadId.trim() !== '' ? rawThreadId : undefined;
        const instrs = rawInstructions && rawInstructions.trim() !== '' ? rawInstructions : undefined;

        const rulesSection = resolveRulesForTool(storage, projectId, 'refine_requirements', 'refinement');

        // Legacy behavior: no thread_id provided (R4, E4)
        if (!threadId) {
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

        // Iterative path: thread_id present (R2, R3, R10)
        const base = explicitPrevOutput !== undefined
          ? explicitPrevOutput
          : (storage.refinements.getLatest(threadId)?.output ?? null);

        const nextIter = storage.refinements.getNextIteration(threadId);

        // Build HTML comment header (design §4)
        const header = [
          '<!-- refine:meta',
          `thread_id: ${threadId}`,
          `iteration: ${nextIter}`,
          `has_base: ${base !== null}`,
          '-->',
        ].join('\n');

        // Check if thread is finalized and emit warning (R10, E6)
        const threadStatus = storage.refinements.getThreadStatus(threadId);
        const warningSection = threadStatus === 'final'
          ? `⚠️ Advertencia: el hilo ${threadId} está finalizado. Esta iteración no se podrá persistir hasta reabrirlo.\n\n`
          : '';

        const bodyParts: string[] = [
          '## Requirements Refinement Analysis',
          '',
        ];

        if (base !== null) {
          bodyParts.push('### Previous Output');
          bodyParts.push(base);
          bodyParts.push('');
        }

        if (instrs) {
          bodyParts.push('### Correction Instructions');
          bodyParts.push(instrs);
          bodyParts.push('');
        }

        bodyParts.push('### Input Requirements');
        bodyParts.push(requirements);
        bodyParts.push('');

        if (rulesSection) {
          bodyParts.push(rulesSection);
        }

        bodyParts.push('### Refinement Instructions');
        bodyParts.push('Please analyze the requirements above and provide:');
        bodyParts.push('');
        bodyParts.push('1. **Clarified Requirements** — Rewrite each requirement to be specific, measurable, achievable, relevant, and time-bound (SMART).');
        bodyParts.push('2. **Ambiguities Identified** — List any vague or contradictory statements that need clarification.');
        bodyParts.push('3. **Missing Information** — Identify what information is missing to fully specify the requirements.');
        bodyParts.push('4. **Edge Cases** — Highlight potential edge cases that should be addressed.');
        bodyParts.push('5. **Acceptance Criteria** — For each refined requirement, suggest clear acceptance criteria.');

        const body = bodyParts.join('\n');

        return `${header}\n\n${warningSection}${body}`;
      }

      case 'check_definition_of_ready': {
        const ticketDescription = input['ticket_description'] as string;
        const projectId = input['project_id'] as string | undefined;

        const rulesSection = resolveRulesForTool(storage, projectId, 'check_definition_of_ready', 'definition_of_ready');

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

        const criteria = rulesSection || defaultDorCriteria.join('\n');

        return [
          '## Definition of Ready Check',
          '',
          '### Ticket Description',
          ticketDescription,
          '',
          '### DoR Criteria to Evaluate',
          criteria,
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
        const projectId = input['project_id'] as string | undefined;

        const rulesSection = resolveRulesForTool(storage, projectId, 'generate_user_stories', 'user_stories');

        return [
          '## User Story Generation',
          '',
          '### Feature Description',
          featureDescription,
          '',
          rulesSection,
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
        const projectId = input['project_id'] as string | undefined;

        const rulesSection = resolveRulesForTool(storage, projectId, 'identify_dependencies', 'dependencies');

        return [
          '## Dependency Analysis',
          '',
          '### Requirements',
          requirements,
          '',
          rulesSection,
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

      case 'refine_save_iteration': {
        const threadId = input['thread_id'] as string;
        const output = input['output'] as string;
        const instructions = input['instructions'] as string | undefined;
        const rawRequirements = input['requirements'] as string | undefined;
        const projectId = input['project_id'] as string | undefined;

        // Block save if thread is finalized (R9, E5)
        if (storage.refinements.getThreadStatus(threadId) === 'final') {
          throw new Error(`El hilo ${threadId} ya está finalizado y no admite nuevas iteraciones`);
        }

        const row = storage.refinements.save({
          thread_id: threadId,
          output,
          instructions: instructions || null,
          requirements: rawRequirements || null,
          project_id: projectId || null,
        });

        return JSON.stringify(row);
      }

      case 'refine_list_iterations': {
        const threadId = input['thread_id'] as string;
        const rows = storage.refinements.listByThread(threadId);
        return JSON.stringify(rows);
      }

      case 'refine_get_latest': {
        const threadId = input['thread_id'] as string;
        const row = storage.refinements.getLatest(threadId);
        return JSON.stringify(row);
      }

      case 'refine_finalize': {
        const threadId = input['thread_id'] as string;
        storage.refinements.finalize(threadId);
        return JSON.stringify({ thread_id: threadId, status: 'final' });
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  }

  return {
    name: 'refine',
    description:
      'Skill de refinamiento iterativo de requerimientos. Soporta ciclos de "propose → user corrige → re-refine" mediante `thread_id`. Incluye prompt-builders puros (`refine_requirements`, `generate_user_stories`, `identify_dependencies`, `check_definition_of_ready`) y tools de persistencia por hilo (`refine_save_iteration`, `refine_list_iterations`, `refine_get_latest`, `refine_finalize`).',
    tools,
    execute,
  };
}
