# Explore — refine-gated-flow

## 1. Prompt actual de `refine_requirements`

[packages/tools/refine/src/index.ts](../../../packages/tools/refine/src/index.ts)

- **Legacy** (sin `thread_id`, líneas 192-208): prompt plano con `## Requirements Refinement Analysis`, `### Input Requirements`, `{rules}`, `### Refinement Instructions` (lista de 5 items: SMART, ambigüedades, missing, edge, AC).
- **Iterativo** (líneas 212-269): `base = previous_output || storage.refinements.getLatest(threadId)?.output`. `nextIter = getNextIteration`. Arma `bodyParts`: header `<!-- refine:meta -->` → warning si `final` → `### Previous Output` → `### Correction Instructions` → `### Input Requirements` → rules → **la misma lista de 5 items**.

El bloque `### Refinement Instructions` (líneas 259-265) es el punto de gating: solo debe aparecer cuando `phase=refinement`.

## 2. Tabla `refinements` y repo

[packages/storage/src/database.ts](../../../packages/storage/src/database.ts) líneas 133-150

Columnas: `id`, `thread_id`, `iteration`, `project_id?`, `requirements?`, `instructions?`, `output?`, `status ('draft'|'final')`, `parent_id?`, `created_at`, `UNIQUE(thread_id, iteration)`.

Migraciones aditivas (líneas 190-194): bloques `try { ALTER TABLE … ADD COLUMN … } catch {}`. No hay carpeta de migraciones. Cualquier columna nueva sigue este patrón.

[packages/storage/src/repositories/refinements.ts](../../../packages/storage/src/repositories/refinements.ts): `save`, `getLatest`, `listByThread`, `getThreadStatus`, `finalize`, `getNextIteration`. Todos sync. Sin campo `phase` hoy.

`RefinementRow` en [packages/storage/src/types.ts:155-166](../../../packages/storage/src/types.ts).

## 3. Registro de tools en la skill

[packages/tools/refine/src/index.ts](../../../packages/tools/refine/src/index.ts): `tools: ToolDefinition[]` (5-169) + `switch(toolName)` en `execute` (176-427). 8 tools registradas hoy. Default: `return 'Unknown tool: …'`.

Agregar tools nuevas (`refine_discover`, `refine_answer_questions`, `refine_get_questions`) requiere entrada en `tools[]` + case en el switch.

## 4. Spec actual

[openspec/specs/refine/spec.md](../../../openspec/specs/refine/spec.md): 13 reqs funcionales, 5 no funcionales, 10 escenarios.

Para gated-flow:
- **ADD**: reqs de fase discovery (extracción, persistencia Q&A, detección "todo resuelto", unlock), tool(s) nuevas, subcomando CLI nuevo.
- **MODIFY**: R1 (param opcional `phase`), R4 (legacy queda igual), R12 (gating en `### Refinement Instructions`).
- **Sin tocar**: R5-R11 (persistencia), R-NF1-5.

## 5. CLI refine

[packages/cli/src/commands/refine.ts:83-133](../../../packages/cli/src/commands/refine.ts) (`refineIterate`): lee `--input`, arma input, llama `toolRegistry.execute('refine_requirements', …)`, extrae `iteration` con regex `/iteration:\s*(\d+)/` (línea 126).

Punto de inserción natural: nuevo subcomando `jarvis refine answer <thread-id>` que toma respuestas y dispara la transición a `phase=refinement`.

## 6. Consumo del prompt

- CLI: `refine.ts:116` (único caller real).
- [packages/http-gateway/src/rules/rule-validator.service.ts:7](../../../packages/http-gateway/src/rules/rule-validator.service.ts): solo string literal, no invoca.
- Header `<!-- refine:meta -->` solo se parsea en `refine.ts:126` (campo `iteration`). `has_base` nunca se lee. Riesgo bajo al evolucionar el header.

## 7. Preguntas abiertas (decidir en proposal)

### Q1 — Storage de Q&A

- **A)** Nueva tabla `refinement_questions` con FK `refinement_id → refinements(id)`: `id`, `refinement_id`, `type ('ambiguity'|'missing')`, `label` (ej. `A1`), `question TEXT`, `answer TEXT NULL`, `answered_at TEXT NULL`.
- **B)** Columna `questions_json TEXT` en `refinements`.
- **Recomendación**: A. Permite queries indexadas ("cuántas abiertas"), single-responsibility, y FK estable por `UNIQUE(thread_id, iteration)`.

### Q2 — Formato que emite el LLM en discovery

- JSON fenced → parseable pero frágil ante comentarios del LLM.
- Lista con tags `[A1]/[M1]` → resiliente, regex simple, espeja estilo actual.
- YAML fenced → intermedio.
- **Recomendación**: lista tagueada `[Ax]/[Mx]`. Parser en `refine_discover` o al recibir la respuesta del LLM (tool nueva `refine_ingest_questions` o similar).

### Q3 — Detección de "todo resuelto"

- **A)** Data-driven: `COUNT(*) WHERE answer IS NULL = 0`.
- **B)** Flag explícito del caller (`force_phase: 'refinement'`).
- **Recomendación**: Híbrido — detectar automático por count + permitir override `force_phase` para bypass intencional (ej. pregunta marcada como "not applicable").

### Q4 — ¿`refine_finalize` exige `phase=refinement`?

Hoy solo chequea que el thread exista. Gated-flow debería agregar invariante: `finalize` rechaza si la última iteración está en `discovery` con preguntas abiertas. Mensaje Spanish con acción sugerida.

### Q5 — Columna `phase` en `refinements`

- **A)** Agregar `phase TEXT NOT NULL DEFAULT 'discovery' CHECK(phase IN ('discovery','refinement'))` vía `ALTER TABLE` aditivo.
- **B)** Inferir dinámicamente por JOIN a `refinement_questions` (si hay abiertas → discovery).
- **Recomendación**: A. Explícito, auditable, y evita JOIN en cada `getLatest`. La derivación dinámica es fuente de bugs sutiles (qué pasa si no se registraron preguntas).

## Envelope

- status: ok
- executive_summary: refine-iterative shipped; el gating debe operar sobre la plantilla del prompt (líneas 259-265 de index.ts) y agregar tabla `refinement_questions` + columna `phase` a `refinements`. 5 preguntas de diseño resueltas con recomendaciones concretas.
- artifacts: openspec/changes/refine-gated-flow/explore.md
- next_recommended: proposal
- risks: migración aditiva sin rollback formal · parser de respuesta del LLM frágil ante formato inesperado · legacy path (sin thread_id) debe seguir intacto
- skill_resolution: injected
