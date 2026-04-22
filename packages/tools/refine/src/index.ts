import { randomUUID } from 'node:crypto';
import type { Skill, ToolDefinition } from '@jarvis/core';
import { resolveRulesForTool } from '@jarvis/core';
import type { Storage } from '@jarvis/storage';

const tools: ToolDefinition[] = [
  {
    name: 'refine_requirements',
    description:
      'Genera un prompt estructurado de refinamiento de requerimientos contra reglas del proyecto. **Esta tool NO ejecuta el análisis** — devuelve un scaffold que el agente invocador debe procesar con su propio LLM, produciendo las 5 secciones listadas (Requerimientos Clarificados, Ambigüedades, Información Faltante, Casos Límite, Criterios de Aceptación). Para iterar: pasá `thread_id` (UUID) y opcionalmente `instructions` con las correcciones del user y/o `previous_output` con el texto a re-refinar. Si no pasás `previous_output`, el tool carga automáticamente el último output guardado del hilo. Si omitís `thread_id`, el tool genera uno nuevo y lo incluye en un header HTML (`<!-- refine:meta thread_id: … iteration: … -->`) al principio de la respuesta — extraelo para llamadas siguientes. Este tool NO persiste: después de mostrar el resultado al user y obtener aprobación, llamá `refine_save_iteration` con `thread_id` + `output`. Cuando el user confirme que está listo, llamá `refine_finalize`.',
    input_schema: {
      type: 'object',
      properties: {
        requirements: {
          type: 'string',
          description: 'Texto crudo de los requerimientos a refinar',
        },
        project_id: {
          type: 'string',
          description: 'Project ID opcional para cargar reglas específicas del proyecto',
        },
        thread_id: {
          type: 'string',
          description: 'Thread ID opcional para refinamiento iterativo. Si se provee, el tool carga el último output guardado como contexto.',
        },
        instructions: {
          type: 'string',
          description: 'Instrucciones de corrección opcionales del user para esta iteración.',
        },
        previous_output: {
          type: 'string',
          description: 'Output previo explícito opcional a usar como contexto, anulando lo que está en DB.',
        },
      },
      required: ['requirements'],
    },
  },
  {
    name: 'check_definition_of_ready',
    description:
      'Genera un prompt para verificar una descripción de ticket contra las reglas de Definition of Ready del proyecto. **Esta tool NO ejecuta el análisis** — devuelve un scaffold que el agente invocador debe procesar con su propio LLM.',
    input_schema: {
      type: 'object',
      properties: {
        ticket_description: {
          type: 'string',
          description: 'Descripción del ticket a evaluar',
        },
        project_id: {
          type: 'string',
          description: 'Project ID opcional para cargar reglas de DoR',
        },
      },
      required: ['ticket_description'],
    },
  },
  {
    name: 'generate_user_stories',
    description:
      'Genera un prompt para descomponer una descripción de feature en historias de usuario bien estructuradas. **Esta tool NO ejecuta el análisis** — devuelve un scaffold que el agente invocador debe procesar con su propio LLM.',
    input_schema: {
      type: 'object',
      properties: {
        feature_description: {
          type: 'string',
          description: 'Descripción del feature o épica a descomponer en historias de usuario',
        },
        project_id: {
          type: 'string',
          description: 'Project ID opcional para cargar reglas específicas del proyecto',
        },
      },
      required: ['feature_description'],
    },
  },
  {
    name: 'identify_dependencies',
    description: 'Genera un prompt para identificar dependencias técnicas y funcionales en un conjunto de requerimientos. **Esta tool NO ejecuta el análisis** — devuelve un scaffold que el agente invocador debe procesar con su propio LLM.',
    input_schema: {
      type: 'object',
      properties: {
        requirements: {
          type: 'string',
          description: 'Texto de requerimientos a analizar en busca de dependencias',
        },
        project_id: {
          type: 'string',
          description: 'Project ID opcional para cargar reglas específicas del proyecto',
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

        // One-shot path: no thread_id provided (R1, D5)
        if (!threadId) {
          const newThreadId = randomUUID();
          const header = [
            '<!-- refine:meta',
            `thread_id: ${newThreadId}`,
            'iteration: 1',
            '-->',
          ].join('\n');
          const body = [
            '### Tu Tarea',
            '',
            'Sos el analizador. Usando el contenido abajo, generá las secciones pedidas en **### Instrucciones de Refinamiento**. No repitas el scaffold — reemplazá cada ítem numerado con tu análisis real. Respondé en español.',
            '',
            'Después de generar el análisis, el agente orquestador debe llamar refine_save_iteration(thread_id, output) con tu respuesta.',
            '',
            '## Análisis de Refinamiento de Requerimientos',
            '',
            '### Requerimientos de Entrada',
            requirements,
            '',
            rulesSection,
            '### Instrucciones de Refinamiento',
            'Analizá los requerimientos anteriores y entregá:',
            '',
            '1. **Requerimientos Clarificados** — Reescribí cada requerimiento para que sea específico, medible, alcanzable, relevante y acotado en el tiempo (SMART).',
            '2. **Ambigüedades Identificadas** — Listá cualquier declaración vaga o contradictoria que requiera clarificación.',
            '3. **Información Faltante** — Identificá qué información falta para especificar los requerimientos completamente.',
            '4. **Casos Límite** — Destacá posibles casos límite que deben ser considerados.',
            '5. **Criterios de Aceptación** — Para cada requerimiento refinado, sugerí criterios de aceptación claros.',
          ].join('\n');
          return `${header}\n\n${body}`;
        }

        // Iterative path: thread_id present (R2, R3, R10)
        const base = explicitPrevOutput !== undefined
          ? explicitPrevOutput
          : (storage.refinements.getLatest(threadId)?.output ?? null);

        const nextIter = storage.refinements.getNextIteration(threadId);

        // Build HTML comment header (design §4, D2 — no has_base)
        const header = [
          '<!-- refine:meta',
          `thread_id: ${threadId}`,
          `iteration: ${nextIter}`,
          '-->',
        ].join('\n');

        const bodyParts: string[] = [
          '### Tu Tarea',
          '',
          'Sos el analizador. Usando el contenido abajo, generá las secciones pedidas en **### Instrucciones de Refinamiento**. No repitas el scaffold — reemplazá cada ítem numerado con tu análisis real. Respondé en español.',
          '',
          'Después de generar el análisis, el agente orquestador debe llamar refine_save_iteration(thread_id, output) con tu respuesta.',
          '',
          '## Análisis de Refinamiento de Requerimientos',
          '',
        ];

        if (base !== null) {
          bodyParts.push('### Output Previo');
          bodyParts.push(base);
          bodyParts.push('');
        }

        if (instrs) {
          bodyParts.push('### Instrucciones de Corrección');
          bodyParts.push(instrs);
          bodyParts.push('');
        }

        if (rulesSection) {
          bodyParts.push(rulesSection);
        }

        bodyParts.push('### Instrucciones de Refinamiento');
        bodyParts.push('Analizá los requerimientos anteriores y entregá:');
        bodyParts.push('');
        bodyParts.push('1. **Requerimientos Clarificados** — Reescribí cada requerimiento para que sea específico, medible, alcanzable, relevante y acotado en el tiempo (SMART).');
        bodyParts.push('2. **Ambigüedades Identificadas** — Listá cualquier declaración vaga o contradictoria que requiera clarificación.');
        bodyParts.push('3. **Información Faltante** — Identificá qué información falta para especificar los requerimientos completamente.');
        bodyParts.push('4. **Casos Límite** — Destacá posibles casos límite que deben ser considerados.');
        bodyParts.push('5. **Criterios de Aceptación** — Para cada requerimiento refinado, sugerí criterios de aceptación claros.');

        const body = bodyParts.join('\n');

        return `${header}\n\n${body}`;
      }

      case 'check_definition_of_ready': {
        const ticketDescription = input['ticket_description'] as string;
        const projectId = input['project_id'] as string | undefined;

        const rulesSection = resolveRulesForTool(storage, projectId, 'check_definition_of_ready', 'definition_of_ready');

        const defaultDorCriteria = [
          '- Resumen claro y conciso que describa el trabajo',
          '- Descripción detallada que explique el problema o feature',
          '- Criterios de aceptación específicos y testeables',
          '- Estimación en story points provista',
          '- Nivel de prioridad definido',
          '- Sin dependencias bloqueantes sin resolver',
          '- Asignado al componente/equipo correcto',
          '- Revisado y aprobado por el product owner',
        ];

        const criteria = rulesSection || defaultDorCriteria.join('\n');

        return [
          '### Tu Tarea',
          '',
          'Sos el evaluador. Analizá la descripción del ticket abajo contra los criterios de DoR y respondé en español con el formato indicado en **### Instrucciones**. No repitas el scaffold.',
          '',
          '## Verificación de Definition of Ready',
          '',
          '### Descripción del Ticket',
          ticketDescription,
          '',
          '### Criterios de DoR a Evaluar',
          criteria,
          '',
          '### Instrucciones',
          'Para cada criterio listado, determiná si la descripción del ticket lo satisface.',
          'Respondé con:',
          '- ✅ PASS — el criterio se cumple claramente',
          '- ❌ FAIL — el criterio no se cumple (explicá qué falta)',
          '- ⚠️ PARTIAL — el criterio se cumple parcialmente (explicá qué necesita mejorar)',
          '',
          'Concluí con un veredicto general **READY** o **NOT READY** y una lista de cambios requeridos.',
        ].join('\n');
      }

      case 'generate_user_stories': {
        const featureDescription = input['feature_description'] as string;
        const projectId = input['project_id'] as string | undefined;

        const rulesSection = resolveRulesForTool(storage, projectId, 'generate_user_stories', 'user_stories');

        return [
          '### Tu Tarea',
          '',
          'Sos el generador de historias de usuario. Usando la descripción del feature abajo, producí historias siguiendo el formato y criterios indicados en **### Instrucciones**. No repitas el scaffold. Respondé en español.',
          '',
          '## Generación de Historias de Usuario',
          '',
          '### Descripción del Feature',
          featureDescription,
          '',
          rulesSection,
          '### Instrucciones',
          'Descompone la descripción del feature en historias de usuario individuales siguiendo el formato estándar:',
          '',
          '**Como** [tipo de usuario], **quiero** [objetivo], **para que** [beneficio].',
          '',
          'Para cada historia, además entregá:',
          '- **Criterios de Aceptación** (formato Given/When/Then)',
          '- **Story Points** (estimación: 1, 2, 3, 5, 8, 13)',
          '- **Prioridad** (Must Have / Should Have / Could Have / Won\'t Have)',
          '- **Dependencias** (otras historias de las que depende)',
          '',
          'Apuntá a historias que sean:',
          '- **Independientes** — se pueden desarrollar y liberar independientemente',
          '- **Negociables** — los detalles pueden discutirse',
          '- **Valiosas** — entregan valor al usuario final',
          '- **Estimables** — el equipo puede estimar el esfuerzo',
          '- **Pequeñas** — entran en un sprint',
          '- **Testeables** — tienen criterios de aceptación claros',
        ].join('\n');
      }

      case 'identify_dependencies': {
        const requirements = input['requirements'] as string;
        const projectId = input['project_id'] as string | undefined;

        const rulesSection = resolveRulesForTool(storage, projectId, 'identify_dependencies', 'dependencies');

        return [
          '### Tu Tarea',
          '',
          'Sos el analizador de dependencias. Usando los requerimientos abajo, identificá y categorizá todas las dependencias siguiendo el formato de **### Instrucciones**. No repitas el scaffold. Respondé en español.',
          '',
          '## Análisis de Dependencias',
          '',
          '### Requerimientos',
          requirements,
          '',
          rulesSection,
          '### Instrucciones',
          'Analizá los requerimientos anteriores e identificá todas las dependencias. Categorizalas como:',
          '',
          '#### Dependencias Técnicas',
          '- Servicios o APIs externos requeridos',
          '- Librerías, frameworks o herramientas necesarias',
          '- Requerimientos de infraestructura o plataforma',
          '- Cambios de schema de base de datos',
          '',
          '#### Dependencias Funcionales',
          '- Features o capacidades que deben existir antes de implementar esto',
          '- Datos que deben estar disponibles o migrados',
          '- Procesos de negocio que deben estar en su lugar',
          '',
          '#### Dependencias de Equipo',
          '- Otros equipos que deben entregar trabajo primero',
          '- Expertos de dominio o aprobaciones requeridas',
          '',
          '#### Evaluación de Riesgo',
          'Para cada dependencia, evaluá:',
          '- **Impacto**: Alto / Medio / Bajo (qué pasa si no se resuelve)',
          '- **Probabilidad**: Alta / Media / Baja (chance de que la dependencia cause demora)',
          '- **Mitigación**: Acción sugerida para resolver la dependencia',
        ].join('\n');
      }

      case 'refine_save_iteration': {
        const threadId = input['thread_id'] as string;
        const output = input['output'] as string;
        const instructions = input['instructions'] as string | undefined;
        const rawRequirements = input['requirements'] as string | undefined;
        const projectId = input['project_id'] as string | undefined;

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
        const status = storage.refinements.getLatest(threadId)?.status ?? 'completed';
        return JSON.stringify({ thread_id: threadId, status });
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
