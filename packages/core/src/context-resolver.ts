import type { Storage, ProjectContext, CognitiveBase } from '@jarvis/storage';
import type { ResolvedContext, ToolDefinition } from './types.js';
import { ToolRegistry } from './tool-registry.js';
import { getJarvisKnowledge } from './jarvis-knowledge.js';

export class ContextResolver {
  constructor(
    private storage: Storage,
    private toolRegistry: ToolRegistry
  ) {}

  resolve(projectId: string | null): ResolvedContext {
    // No project → respond as "Jarvis talking about itself". Load the
    // knowledge base directly and skip cognitive base / project context.
    // This keeps `jarvis_chat` scoped to Jarvis meta-questions and forces
    // the model to decline when asked about projects.
    if (!projectId) {
      const systemPrompt = getJarvisKnowledge(this.toolRegistry, { forSystemPrompt: true });
      return { systemPrompt, availableTools: [], projectId: null };
    }

    const cognitiveBase = this.storage.cognitive.getActive() ?? null;
    const projectContext = this.storage.projects.getFullContext(projectId) ?? null;

    const systemPrompt = this.buildSystemPrompt(cognitiveBase, projectContext);
    const availableTools = this.resolveTools(projectContext);

    return { systemPrompt, availableTools, projectId };
  }

  private buildSystemPrompt(
    cognitiveBase: CognitiveBase | null,
    project: ProjectContext | null
  ): string {
    const sections: string[] = [];

    // 1. Identity
    sections.push(`# JARVIS — Asistente de Desarrollo

Eres JARVIS, un agente de IA personal para un desarrollador de software. Tu rol es ayudar a resolver tareas técnicas combinando tu conocimiento con el contexto específico del proyecto y la forma de pensar del desarrollador.

Responde siempre en español a menos que el usuario escriba en otro idioma. Sé directo, concreto y orientado a la acción.`);

    // 2. Cognitive base
    if (cognitiveBase) {
      sections.push(`## Base Cognitiva del Desarrollador

Estas son las preferencias y forma de trabajo del desarrollador. Úsalas para alinear tus respuestas:

${cognitiveBase.content}`);
    }

    // 3. Project context
    if (project) {
      sections.push(this.buildProjectSection(project));
    } else {
      sections.push(`## Proyecto

No hay proyecto activo en esta sesión. El usuario puede estar haciendo consultas generales.`);
    }

    // 4. Response format instructions
    sections.push(`## Instrucciones de Formato

- Usa markdown para estructurar respuestas largas
- Cuando generes código, incluye el lenguaje en los bloques de código
- Si necesitas más información para una tarea, pregunta antes de asumir
- Al usar tools, explica brevemente qué vas a hacer y por qué
- Si detectas problemas en un requerimiento, señálalos antes de ejecutar`);

    return sections.join('\n\n');
  }

  private buildProjectSection(project: ProjectContext): string {
    const parts: string[] = [];
    parts.push(`## Proyecto Activo: ${project.project.name}`);

    if (project.project.description) {
      parts.push(project.project.description);
    }
    if (project.project.sector) {
      parts.push(`**Sector:** ${project.project.sector}`);
    }

    // Stack
    if (project.stack.length > 0) {
      parts.push('### Stack Tecnológico');
      for (const s of project.stack) {
        const note = s.notes ? ` (${s.notes})` : '';
        parts.push(`- **${s.layer}:** ${s.value}${note}`);
      }
    }

    // Rules
    if (project.rules.length > 0) {
      parts.push('### Reglas y Convenciones');
      const byCategory = new Map<string, string[]>();
      for (const r of project.rules) {
        if (!byCategory.has(r.category)) byCategory.set(r.category, []);
        byCategory.get(r.category)!.push(r.rule);
      }
      for (const [cat, rules] of byCategory) {
        parts.push(`**${cat}:**`);
        for (const rule of rules) {
          parts.push(`- ${rule}`);
        }
      }
    }

    // Integrations
    if (project.integrations.length > 0) {
      parts.push('### Integraciones Configuradas');
      for (const i of project.integrations) {
        const config = JSON.parse(i.config);
        const summary = Object.entries(config)
          .map(([k, v]) => {
            const display = k.includes('key') || k.includes('token')
              ? '****' + String(v).slice(-4)
              : String(v);
            return `${k}=${display}`;
          })
          .join(', ');
        parts.push(`- **${i.service}**: ${summary}`);
      }
    }

    // Knowledge (top 5 most recent)
    if (project.knowledge.length > 0) {
      parts.push('### Conocimiento del Proyecto');
      const top5 = project.knowledge.slice(0, 5);
      for (const k of top5) {
        parts.push(`#### ${k.title}\n${k.content}`);
      }
    }

    return parts.join('\n\n');
  }

  private resolveTools(project: ProjectContext | null): ToolDefinition[] {
    const allTools = this.toolRegistry.getTools();

    if (!project) return allTools;

    // Filter out tools for integrations that aren't configured
    const configuredServices = new Set(project.integrations.map(i => i.service));

    return allTools.filter(tool => {
      // If tool name starts with a known integration prefix, check if configured
      if (tool.name.startsWith('jira_') && !configuredServices.has('jira')) return false;
      if (tool.name.startsWith('n8n_') && !configuredServices.has('n8n')) return false;
      return true;
    });
  }
}
