# Proposal — refine-gated-flow

## 1. Intent

Hoy `refine_requirements` pide al LLM todo a la vez (SMART + ambigüedades + missing info + edge cases + AC) en el mismo prompt. Resultado: el modelo "resuelve" ambigüedades con supuestos implícitos y emite criterios de aceptación sobre una interpretación no validada. Este cambio introduce un *gating* de dos fases: primero se extraen y persisten preguntas (ambigüedades + missing info), luego se responden, y recién entonces se habilita el prompt de refinamiento SMART/AC con las respuestas como contexto resuelto. El objetivo es reducir refinamientos incorrectos por drift interpretativo del LLM.

## 2. Scope

**In-scope:**
- Tabla nueva `refinement_questions` (aditiva) con FK a `refinements(id)`: `id`, `refinement_id`, `type ('ambiguity'|'missing')`, `label` (`A1`/`M1`), `question`, `answer NULL`, `answered_at NULL`, `created_at`.
- Columna nueva `phase TEXT NOT NULL DEFAULT 'discovery' CHECK(phase IN ('discovery','refinement'))` en `refinements`, vía `ALTER TABLE` aditivo con try/catch.
- Prompt de `refine_requirements` gatea el bloque `### Refinement Instructions` por `phase`. En `discovery` emite solo instrucciones para listar ambigüedades/missing info con tags `[Ax]/[Mx]`. En `refinement` reaparece el bloque actual + nueva sección `### Resolved Context` con Q&A cerradas.
- 3 tools nuevas en `packages/tools/refine`:
  - `refine_discover(thread_id, requirements, project_id?)` → emite prompt de phase discovery.
  - `refine_ingest_questions(thread_id, iteration, llm_response)` → parsea `[Ax]/[Mx]` con regex y persiste filas en `refinement_questions`; error si `count==0` tras parse.
  - `refine_answer_questions(thread_id, answers: {label, text}[])` → marca respuestas; cuando `COUNT(answer IS NULL)=0`, la próxima `save` puede fijar `phase='refinement'`.
- CLI: `jarvis refine discover <thread>`, `jarvis refine questions <thread>` (list), `jarvis refine answer <thread> -q A1="texto" -q M1="texto"`. `iterate` sigue funcionando y respeta el gating.
- `refine_finalize` rechaza si la última iter está en `phase='discovery'` con preguntas abiertas (excepto si `status='final'`).
- Param `force_phase: 'refinement'` en `refine_requirements` como escape-hatch.

**Out-of-scope:**
- Rondas de discovery múltiples automáticas (las orquesta el caller).
- Ranking/priorización de preguntas por criticidad.
- Auto-responder desde Jira/Notion.
- Embeddings o clustering de preguntas.

## 3. Approach

`refine_requirements` consulta `getLatestPhase(threadId)`. Si es `discovery` con preguntas abiertas y no hay `force_phase`, emite el prompt de discovery (instrucciones para listar solo ambigüedades y missing info con tags `[Ax]`/`[Mx]`). Si es `refinement` (o si el caller fuerza), emite el prompt actual extendido con `### Resolved Context` que inyecta las Q&A cerradas como contexto.

Flujo típico: (1) caller llama `refine_discover` o `refine_requirements` en phase discovery, (2) el LLM devuelve la lista tagueada, (3) caller pasa esa respuesta a `refine_ingest_questions` que persiste, (4) caller responde con `refine_answer_questions`, (5) cuando todas están cerradas, la siguiente iteración marca `phase='refinement'` al guardar y el próximo `refine_requirements` arma el prompt SMART/AC con Q&A como contexto, (6) `refine_finalize` cierra el hilo.

**Archivos afectados:** `packages/storage/src/database.ts` (tabla + ALTER), `packages/storage/src/types.ts` (row types), nuevo `packages/storage/src/repositories/refinement-questions.ts`, `packages/tools/refine/src/index.ts` (tools + switch + templates), `packages/cli/src/commands/refine.ts` + `index.ts` (subcomandos), `packages/docs/mcp-instructions.md`, `packages/core/jarvis-knowledge.ts` (catálogo).

## 4. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Storage de Q&A | Tabla `refinement_questions` con FK a `refinements(id)` | Queryable, auditable, escala con N iteraciones, COUNT trivial. |
| Formato que emite el LLM | Lista con tags `[Ax]`/`[Mx]` | Resiliente a comentarios del LLM; regex estable; espeja el estilo de las secciones actuales. |
| Detección "resuelto" | Count automático + override `force_phase` | Default seguro; escape-hatch controlado para casos N/A. |
| Columna `phase` | En `refinements` (explícita) | Auditable, evita JOIN en cada `getLatest`, fuente única de verdad. |
| `refine_finalize` | Rechaza si `phase='discovery'` con abiertas | Protege contra cerrar hilos con ambigüedades sin resolver. |
| Parsing | Tool dedicada `refine_ingest_questions` | Single-responsibility; el caller pasa texto, la tool extrae `[A1] …` con regex y persiste. |

## 5. Affected packages

- `packages/storage` — tabla + columna + repo nuevo + types.
- `packages/tools/refine` — 3 tools nuevas + switch + prompt templates gateados.
- `packages/cli` — 3 subcomandos nuevos + ajustes menores a `iterate`.
- `packages/docs` — `mcp-instructions.md` con flujo de 2 fases.
- `packages/core/jarvis-knowledge.ts` — regenera catálogo; requiere `jarvis mcp sync` post-deploy.

## 6. Risks & rollback

- **Parser frágil:** si el LLM no respeta `[Ax]/[Mx]`, `refine_ingest_questions` puede perder preguntas. Mitigación: validación estricta + error si `count==0` tras parse (señal de drift).
- **Hilos pre-existentes:** la columna `phase` default `'discovery'` podría romper `refine_finalize` para hilos ya `final`. Mitigación: si `status='final'`, se omite el guard de phase.
- **Rollback:** `DROP TABLE refinement_questions;` + mantener `phase` (aditiva, no destructiva) + revert del feature branch. Hilos existentes quedan en `discovery` pero sin preguntas abiertas, por lo que `finalize` no los bloquea.

## 7. Non-goals

- No auto-responder preguntas desde integraciones externas.
- No clustering ni deduplicación semántica de preguntas entre iteraciones.
- No permitir reopen de un hilo tras `finalize`.
- No generar preguntas por el servidor sin pasar por el LLM.
- No romper el path legacy (`refine_requirements` sin `thread_id` sigue idéntico).
