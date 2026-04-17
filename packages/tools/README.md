# JARVIS Tools

Los tools son los bloques fundamentales del sistema JARVIS. Cada tool encapsula una capacidad concreta que Claude puede ejecutar — refinamiento de requerimientos, revisión de código, interacción con Jira, etc.

---

## ¿Qué son los JARVIS Tools?

Un tool es un paquete TypeScript que define una o más capacidades ejecutables. Cada tool:

- Tiene un **objetivo fijo** que no cambia nunca
- **Genera un prompt estructurado** — no hace análisis con IA por sí mismo
- El análisis de IA ocurre en el **agente loop** (`packages/agent`), no dentro del tool

Los tools son productores de prompts, no agentes. Reciben un input, consultan las reglas del proyecto, y entregan un prompt completo y contextualizado al agente para que lo ejecute.

---

## Principio Arquitectónico: Objetivo Fijo + Reglas Dinámicas

### Objetivo fijo

Cada tool hace **una sola cosa**, siempre. No se puede modificar qué hace un tool — solo cómo lo hace.

### Reglas dinámicas

Las reglas vienen del proyecto, no del código. Son premisas, formas de pensar o afirmaciones factuales sobre el contexto del proyecto. Se inyectan en el prompt del tool en tiempo de ejecución, personalizando el *cómo* sin alterar el *qué*.

**Ejemplo concreto:**

El tool `check_definition_of_ready` siempre evalúa si un ticket cumple la Definition of Ready. Pero:

- Un proyecto **fintech** puede tener la regla: *"Considerar cumplimiento regulatorio en cada ticket"*
- Un proyecto **e-commerce** puede tener: *"Verificar responsividad mobile antes de aceptar un ticket"*

El tool es el mismo. Las reglas lo calibran al contexto del proyecto.

---

## Validación de Reglas (Garantía de Calibración)

Cuando se agrega una regla vía API o CLI, la IA la **valida antes de almacenarla**. La validación verifica:

1. **Sin conflictos** — la regla no contradice reglas existentes del proyecto
2. **Alineación con el objetivo** — la regla no desvía al tool de su función principal
3. **Coherencia contextual** — tiene sentido dado el sector, stack y convenciones del proyecto

Si la validación falla, la regla es **rechazada con feedback** explicando por qué.

Esto garantiza que los tools estén siempre calibrados — hacen lo que se supone que deben hacer, aunque el proyecto tenga cientos de reglas.

---

## Tools Disponibles

### `@jarvis/tools-refine` — Refinamiento de Requerimientos

| Tool | Descripción |
|------|-------------|
| `refine_requirements` | Refina requerimientos crudos aplicando criterios SMART |
| `check_definition_of_ready` | Evalúa tickets contra la Definition of Ready del proyecto |
| `generate_user_stories` | Desglosa features en user stories siguiendo criterios INVEST |
| `identify_dependencies` | Mapea dependencias técnicas, funcionales y de equipo |

### `@jarvis/tools-code` — Asistencia de Código

| Tool | Descripción |
|------|-------------|
| `code_generate` | Genera código con contexto del proyecto (stack, convenciones) |
| `code_review` | Revisa código contra las convenciones del proyecto |
| `code_generate_tests` | Genera tests unitarios e integración |
| `code_generate_commit_message` | Genera mensajes de commit en formato convencional |
| `code_debug_error` | Depura errores con contexto del proyecto |

### `@jarvis/tools-jira` — Integración con Jira

| Tool | Descripción |
|------|-------------|
| `jira_get_ticket` | Obtiene un ticket de Jira por ID |
| `jira_analyze_ticket` | Analiza la calidad de un ticket |
| `jira_list_my_tickets` | Lista los tickets asignados al usuario |
| `jira_add_comment` | Agrega un comentario a un ticket |
| `jira_transition_ticket` | Cambia el estado de un ticket |

### `@jarvis/tools-n8n` — Integración con n8n

| Tool | Descripción |
|------|-------------|
| `n8n_list_workflows` | Lista los workflows disponibles en n8n |
| `n8n_trigger_workflow` | Dispara un workflow por ID |
| `n8n_get_execution_status` | Consulta el estado de una ejecución |

---

## Cómo Agregar Reglas

Las reglas se agregan por proyecto usando el CLI o el gateway HTTP.

**Via CLI:**
```bash
jarvis project rules add <project-id>
```

**Via HTTP:**
```http
POST /api/projects/:id/rules
Content-Type: application/json

{
  "category": "definition_of_ready",
  "rule": "Todo ticket debe incluir criterios de aceptación en formato Given/When/Then",
  "tool_name": "check_definition_of_ready"
}
```

El campo `tool_name` es **opcional**:
- Si está definido, la regla aplica **solo a ese tool**
- Si es `null`, la regla aplica a **todos los tools de esa categoría**

---

## Cómo Crear un Nuevo Tool

1. **Crear el paquete** bajo `packages/tools/<nombre>/`

2. **Exportar una factory** que recibe el storage y retorna un `Skill`:
   ```typescript
   export function createMiTool(storage: StoragePort): Skill {
     return {
       name: "mi_tool",
       tools: [ /* definiciones */ ],
       execute: async (toolName, input, context) => { /* ... */ }
     }
   }
   ```

3. **Definir cada tool** con `name`, `description` e `input_schema` (JSON Schema)

4. **Inyectar reglas del proyecto** en el método `execute()`:
   ```typescript
   import { resolveRulesForTool } from "@jarvis/core"

   const rules = await resolveRulesForTool(storage, context.projectId, toolName)
   // Incluir `rules` en el prompt generado
   ```

5. **Registrar el tool** en:
   - `packages/cli/src/bootstrap.ts` — para el CLI
   - `packages/mcp/src/server.ts` — para el servidor MCP

---

## Principios Resumidos

| # | Principio | Descripción |
|---|-----------|-------------|
| 1 | **Objetivo fijo** | Cada tool hace una sola cosa, siempre |
| 2 | **Reglas dinámicas** | Las reglas vienen del proyecto, no del código |
| 3 | **Validación con IA** | Toda regla se valida antes de almacenarse |
| 4 | **Calibración garantizada** | Las reglas no pueden desviar el objetivo del tool |
| 5 | **Contexto por proyecto** | Las reglas de un proyecto no afectan a otro |
