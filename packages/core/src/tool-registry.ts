import type { Skill, ToolDefinition } from './types.js';

export class ToolRegistry {
  private skills: Map<string, Skill> = new Map();

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  unregister(name: string): void {
    this.skills.delete(name);
  }

  getTools(): ToolDefinition[] {
    // Returns all tools from all registered skills
    const tools: ToolDefinition[] = [];
    for (const skill of this.skills.values()) {
      tools.push(...skill.tools);
    }
    return tools;
  }

  // Find which skill owns a tool and execute it
  async execute(toolName: string, input: Record<string, unknown>): Promise<string> {
    for (const skill of this.skills.values()) {
      const tool = skill.tools.find(t => t.name === toolName);
      if (tool) {
        return skill.execute(toolName, input);
      }
    }
    throw new Error(`Unknown tool: ${toolName}`);
  }

  getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }
}
