# Change: toon-rollout-high-gain

## Why

Tras migrar `jira_get_ticket` a TOON, quedan 6 tools MCP que devuelven datos estructurados (JSON o Markdown ad-hoc) y se benefician claramente del formato TOON para reducir tokens en las respuestas al LLM. Son las tools de "alta ganancia" identificadas en review:
- `jira_list_my_tickets` — hoy texto crudo de ACLI.
- `n8n_list_workflows` — hoy Markdown con `- [ACTIVE] name (ID: x)`.
- `n8n_get_execution_status` — hoy Markdown con lista de campos.
- `project_list_workflows` / `project_register_workflow` (persist) / `project_unregister_workflow` — hoy `JSON.stringify(...)`.

El cambio es puramente de serialización: no se alteran los campos que cada tool ya proyecta hoy.

## What changes

- `jira_list_my_tickets`: ejecutar `acli jira workitem search --jql "..." --json`, `JSON.parse`, `toTOON`.
- `n8n_list_workflows`: mantener proyección `{id,name,active,updatedAt}`, emitir con `toTOON` en vez de Markdown.
- `n8n_get_execution_status`: proyectar `{id,status,workflowId,startedAt,stoppedAt,error?}` y emitir con `toTOON`.
- `project_list_workflows` / `project_register_workflow` (persist) / `project_unregister_workflow`: reemplazar `JSON.stringify(payload)` por `toTOON(payload)` sin tocar el payload.
- Agregar `@jarvis/toon` como dependencia de `@jarvis/tools-n8n` (package.json + tsconfig references).
- Actualizar `description` MCP de las 6 tools para mencionar "TOON".
- Los branches de error siguen devolviendo strings legibles sin TOON.

## Out of scope

- Proyectar más o menos campos que los actuales (política: serialización pura).
- Tools de "ganancia media" (`n8n_trigger_workflow`) o "no candidatas" (`jira_add_comment`, `jira_transition_ticket`, `code_*`, `refine_*`).
- Tests unitarios (el monorepo no tiene tests hoy; se mantiene esa política).
