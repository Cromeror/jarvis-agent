# Tasks — refine-gated-flow

## Fase 1 — Schema & Storage

- [ ] **1.1** Agregar migración aditiva de columna `phase` en `packages/storage/src/database.ts`
  - [ ] 1.1.1 Dentro del bloque de migraciones, añadir `try { db.exec("ALTER TABLE refinements ADD COLUMN phase TEXT NOT NULL DEFAULT 'discovery' CHECK(phase IN ('discovery','refinement'))") } catch {}`
  - [ ] 1.1.2 Verificar que el patrón sigue el existente de `ALTER TABLE project_rules ADD COLUMN tool_name`
- [ ] **1.2** Crear tabla `refinement_questions` con índices en `database.ts`
  - [ ] 1.2.1 `CREATE TABLE IF NOT EXISTS refinement_questions` con campos: `id`, `refinement_id` (FK → `refinements(id) ON DELETE CASCADE`), `thread_id`, `label`, `type CHECK(...)`, `question`, `answer`, `answered_at`, `created_at DEFAULT (datetime('now'))`, `UNIQUE(thread_id, label)`
  - [ ] 1.2.2 `CREATE INDEX IF NOT EXISTS idx_refq_thread ON refinement_questions(thread_id)`
  - [ ] 1.2.3 `CREATE INDEX IF NOT EXISTS idx_refq_refinement ON refinement_questions(refinement_id)`
  - [ ] 1.2.4 `CREATE INDEX IF NOT EXISTS idx_refq_unanswered ON refinement_questions(thread_id, answer) WHERE answer IS NULL`
- [ ] **1.3** Extender tipos en `packages/storage/src/types.ts`
  - [ ] 1.3.1 Añadir campo `phase: 'discovery' | 'refinement'` a `RefinementRow`
  - [ ] 1.3.2 Crear interfaz `RefinementQuestionRow` con todos los campos del DDL
  - [ ] 1.3.3 Crear interfaz `ParsedQuestion { label: string; type: 'ambiguity' | 'missing'; question: string }`
- [ ] **1.4** Crear repo `packages/storage/src/repositories/refinement-questions.ts`
  - [ ] 1.4.1 `ingest(refinementId, threadId, parsed: ParsedQuestion[]): RefinementQuestionRow[]` — upsert via `ON CONFLICT(thread_id, label) DO UPDATE SET question=excluded.question`; retorna filas upsertadas
  - [ ] 1.4.2 `listByThread(threadId): RefinementQuestionRow[]` — todas las filas del thread (answered + unanswered), ordenadas por `label`
  - [ ] 1.4.3 `listOpen(threadId): RefinementQuestionRow[]` — `WHERE answer IS NULL`
  - [ ] 1.4.4 `countOpen(threadId): number` — usa el índice parcial
  - [ ] 1.4.5 `answer(threadId, label, answerText): RefinementQuestionRow` — `UPDATE SET answer=?, answered_at=datetime('now')`; lanza error si label no existe; si `answerText === ''` persiste `NULL`
- [ ] **1.5** Registrar repo en `Storage` interface y factory
  - [ ] 1.5.1 Añadir `refinementQuestions: ReturnType<typeof createRefinementQuestionsRepo>` a la interfaz `Storage`
  - [ ] 1.5.2 Instanciar y exponer el repo en la función factory de storage
- [ ] **1.6** Tests unitarios (vitest) en `packages/storage`
  - [ ] 1.6.1 Test `ingest` inserta N filas correctamente
  - [ ] 1.6.2 Test `ingest` idempotente — reinsertar mismo label actualiza `question`, no duplica
  - [ ] 1.6.3 Test `answer` actualiza campo y `answered_at`; `''` persiste como `NULL`
  - [ ] 1.6.4 Test `countOpen` decrementa tras cada `answer`
  - [ ] 1.6.5 Test `listOpen` devuelve solo sin responder
  - [ ] 1.6.6 Test `answer` con label inexistente lanza error

**CHECKPOINT 1: `pnpm nx test @jarvis/storage` pasa en verde.**

---

## Fase 2 — Parser

- [ ] **2.1** Crear `packages/tools/refine/src/question-parser.ts`
  - [ ] 2.1.1 Implementar regex multiline: `/^\[([AM])(\d+)\]\s+([\s\S]+?)(?=\n\[[AM]\d+\]|\n*$)/gm`
  - [ ] 2.1.2 Función `parseQuestions(text: string): ParsedQuestion[]` — itera matches, mapea `A` → `ambiguity` / `M` → `missing`, trim del texto de pregunta; descarta duplicados de label (primera ocurrencia gana)
  - [ ] 2.1.3 Si resultado vacío, lanza `Error('No se extrajeron preguntas del texto recibido')`
- [ ] **2.2** Tests unitarios del parser
  - [ ] 2.2.1 Input normal de 3 markers → array de 3 `ParsedQuestion`
  - [ ] 2.2.2 Input con texto adicional antes y después de los markers → solo extrae markers
  - [ ] 2.2.3 Input con pregunta multi-línea → captura toda la pregunta hasta el próximo marker
  - [ ] 2.2.4 Input con whitespace extra y tabs → trimmea correctamente
  - [ ] 2.2.5 Input sin markers → lanza error
  - [ ] 2.2.6 Input con label duplicado `[A1]` aparece dos veces → solo el primero; resultado tiene 1 ítem
  - [ ] 2.2.7 Solo tipo `[Mx]` sin `[Ax]` → funciona correctamente, type `'missing'`

---

## Fase 3 — Tools nuevas + extensión de tools existentes

- [ ] **3.1** Implementar `refine_discover` en `packages/tools/refine/src/index.ts`
  - [ ] 3.1.1 Input schema: `{ thread_id: string; requirements: string; project_id?: string }`
  - [ ] 3.1.2 Construir `discoveryPrompt` que solo pide al LLM listar ambigüedades (`[Ax]`) y missing info (`[Mx]`), sin SMART, edge cases ni AC
  - [ ] 3.1.3 Si no hay `thread_id`, generar UUID v4
  - [ ] 3.1.4 Retornar `{ thread_id, prompt }` como JSON string
- [ ] **3.2** Implementar `refine_ingest_questions`
  - [ ] 3.2.1 Input schema: `{ thread_id: string; iteration: number; llm_response: string }`
  - [ ] 3.2.2 Llamar `parseQuestions(llm_response)` — propagar error si vacío
  - [ ] 3.2.3 Resolver `refinement_id` via `storage.refinements.getLatest(thread_id)` — error si no existe
  - [ ] 3.2.4 Llamar `storage.refinementQuestions.ingest(refinementId, threadId, parsed)`
  - [ ] 3.2.5 Retornar lista de filas como JSON string
- [ ] **3.3** Implementar `refine_answer_questions`
  - [ ] 3.3.1 Input schema: `{ thread_id: string; answers: { label: string; answer: string }[] }`
  - [ ] 3.3.2 Iterar `answers`; llamar `storage.refinementQuestions.answer(thread_id, label, answer)` por cada par; acumular errores si label no existe
  - [ ] 3.3.3 Retornar `{ answered: number; remaining: number }` como JSON string

- [ ] **3.3b** Implementar `refine_get_questions` (tool read-only)
  - [ ] 3.3b.1 Input schema: `{ thread_id: string }`
  - [ ] 3.3b.2 Llamar `storage.refinementQuestions.listOpen` y `.listByThread` (filtrar answered)
  - [ ] 3.3b.3 Retornar `{ open: RefinementQuestionRow[], answered: RefinementQuestionRow[], counts: { open, answered } }` como JSON string
  - [ ] 3.3b.4 Si el thread no existe, devolver `{ open: [], answered: [], counts: { open: 0, answered: 0 } }` sin error
- [ ] **3.4** Implementar `resolveEffectivePhase` (función interna)
  - [ ] 3.4.1 Si `force_phase` presente, retornar `force_phase`
  - [ ] 3.4.2 Consultar `storage.refinements.getLatest(threadId)?.phase ?? 'discovery'`
  - [ ] 3.4.3 Si `lastPhase === 'discovery'` y `countOpen === 0` y `listByThread.length > 0`, retornar `'refinement'` (auto-transición)
  - [ ] 3.4.4 Si no hay thread_id, retornar `null` (path legacy)
- [ ] **3.5** Extender `refine_requirements`
  - [ ] 3.5.1 Añadir `force_phase?: 'refinement'` al input schema
  - [ ] 3.5.2 Si `thread_id` presente, llamar `resolveEffectivePhase`
  - [ ] 3.5.3 Si `phase === 'discovery'`: emitir `discoveryPrompt` auto-contenido (ver 3.5.3a–3.5.3f abajo). NO incluir `### Refinement Instructions`.
    - [ ] 3.5.3a Header `<!-- refine:meta -->` con `thread_id`, `iteration` (próxima, vía `getNextIteration`), `phase: discovery`, `open_questions`, `answered_questions`.
    - [ ] 3.5.3b Sección con el requerimiento + `rulesSection` + `instructions` (si viene).
    - [ ] 3.5.3c Sección `### Preguntas abiertas (N)` listando cada una como `` - `[label]` (type) question ``. Si N=0, texto "_No hay preguntas abiertas registradas._".
    - [ ] 3.5.3d Sección `### Preguntas ya respondidas (M)` listando cada una con `question → answer`. Si M=0, "_Ninguna todavía._".
    - [ ] 3.5.3e Sección `### Qué tenés que hacer ahora` con los 3 caminos (A: responder, B: agregar, C: avanzar) incluyendo los nombres literales de las tools (`refine_answer_questions`, `refine_ingest_questions`, `refine_requirements`) y el `thread_id` literal en cada ejemplo de llamada.
    - [ ] 3.5.3f Sección `### Reglas estrictas` con: no emitir SMART/AC/edge cases, no inventar respuestas, no reusar labels con wording distinto.
  - [ ] 3.5.4 Si `phase === 'refinement'`: construir prompt con (a) header meta `phase: refinement`, (b) requerimiento, (c) `base` (output iteración anterior, si hay), (d) `instructions`, (e) `### Resolved Context` listando Q&A answered como `**[label]** question → answer`, (f) si hay abiertas (caso `force_phase`), `### ⚠️ Preguntas NO resueltas`, (g) `rulesSection`, (h) `### Refinement Instructions` (SMART + AC + edge cases + implementation notes), (i) nota final con la tool call literal `refine_save_iteration(thread_id: "<id>", output: "<texto>")` y `refine_finalize(thread_id: "<id>")`. Cubrir GF-E5.
  - [ ] 3.5.5 Si no hay `thread_id`: comportamiento legacy sin cambios (GF-E9). No leer ni escribir en `refinements` ni `refinement_questions`.
  - [ ] 3.5.6 Iterar en discovery NO debe crear filas nuevas en `refinements`: `refine_requirements` en discovery solo lee, no llama `save` (GF-E15).
- [ ] **3.6** Extender `refine_save_iteration`
  - [ ] 3.6.1 Calcular `phase` según regla: `force_phase==='refinement'` → `'refinement'`; else si `countOpen===0` y `listByThread.length>0` → `'refinement'`; else mantener `phase` de la última iteración (`?? 'discovery'`)
  - [ ] 3.6.2 Pasar `phase` al `storage.refinements.save`
- [ ] **3.7** Extender `refine_finalize`
  - [ ] 3.7.1 Si thread ya está en `status='final'`, retornar sin error (idempotencia)
  - [ ] 3.7.2 Si `latest.phase === 'discovery'` y `countOpen > 0`, lanzar error con mensaje en español que sugiere `jarvis refine answer` o `force_phase=refinement`
  - [ ] 3.7.3 Continuar con lógica de finalización existente
- [ ] **3.8** Registrar las 4 tools nuevas en `createRefineSkill`
  - [ ] 3.8.1 Añadir `refine_discover`, `refine_ingest_questions`, `refine_answer_questions`, `refine_get_questions` al array `tools[]`
  - [ ] 3.8.2 Añadir casos al `switch` de `execute`
  - [ ] 3.8.3 Actualizar la descripción de la skill `refine` para mencionar las 2 fases y aclarar: iterar en discovery = responder preguntas (no llamar `save`); iterar en refinement = emitir nuevo output y llamar `save`.
- [ ] **3.9** Tests unitarios de tools en `packages/tools/refine`
  - [ ] 3.9.1 `refine_discover`: devuelve prompt con instrucciones discovery y sin `### Refinement Instructions`
  - [ ] 3.9.2 `refine_ingest_questions`: persiste 3 filas dado texto válido; error si texto vacío
  - [ ] 3.9.3 `refine_answer_questions`: actualiza respuestas; `remaining` decrementado correctamente
  - [ ] 3.9.4 `refine_requirements` sin thread_id → prompt legacy (GF-E9)
  - [ ] 3.9.5 `refine_requirements` con thread en `discovery` → prompt sin `### Refinement Instructions` (GF-E1)
  - [ ] 3.9.6 `refine_requirements` con thread en `refinement` → prompt con `### Resolved Context` y `### Refinement Instructions` (GF-E5)
  - [ ] 3.9.7 `refine_requirements` con `force_phase='refinement'` y preguntas abiertas → modo refinement (GF-E7)
  - [ ] 3.9.8 `refine_finalize` con preguntas abiertas → error en español (GF-E6)
  - [ ] 3.9.9 `refine_finalize` sobre hilo `status='final'` → idempotente, sin error
  - [ ] 3.9.10 Prompt de discovery (GF-E13): assertions sobre el string devuelto — contiene `thread_id: <id>` literal en header; contiene `refine_answer_questions(thread_id: "<id>"`; lista cada pregunta abierta con su label; lista cada respondida con su answer; contiene prohibición "no escribas AC".
  - [ ] 3.9.11 `refine_get_questions` (GF-E14): devuelve `{open, answered, counts}` con contadores correctos y no modifica DB (comparar `listByThread` antes/después).
  - [ ] 3.9.12 Iterar en discovery no crea filas (GF-E15): llamar `refine_answer_questions` + `refine_requirements` consecutivos, verificar `refinements.listByThread` sin incremento.

**CHECKPOINT 2: `pnpm nx test @jarvis/storage @jarvis/tools-refine` pasa en verde.**

---

## Fase 4 — CLI

- [ ] **4.1** Implementar `jarvis refine discover [thread?]` en `packages/cli/src/commands/refine.ts`
  - [ ] 4.1.1 Acepta `--input <file>` para leer requirements desde archivo y `-p <proj>` para `project_id`
  - [ ] 4.1.2 Si `thread` ausente, generar UUID
  - [ ] 4.1.3 Llamar `refine_discover` via MCP tool runner (igual que `iterate`)
  - [ ] 4.1.4 Imprimir en español: "Hilo: <thread_id>\nPrompt generado:\n<prompt>"
- [ ] **4.2** Implementar `jarvis refine questions <thread>`
  - [ ] 4.2.1 Leer `storage.refinementQuestions.listByThread(thread)` directamente (o via tool route interna)
  - [ ] 4.2.2 Imprimir tabla columnas: `ETIQUETA │ TIPO │ PREGUNTA │ RESPUESTA`; las sin responder muestran `(pendiente)`
  - [ ] 4.2.3 Imprimir resumen al final: "Total: N. Respondidas: X. Pendientes: Y."
- [ ] **4.3** Implementar `jarvis refine answer <thread> -q label=texto`
  - [ ] 4.3.1 Flag `-q` acepta `LABEL=texto` y es repetible (`-q A1="sí" -q M1="no"`)
  - [ ] 4.3.2 Parsear cada valor en `{label, answer}`
  - [ ] 4.3.3 Llamar `refine_answer_questions` con el array de pares
  - [ ] 4.3.4 Imprimir: "Respuestas aplicadas: A1, M1. Preguntas pendientes: Y."
  - [ ] 4.3.5 Si label no existe, imprimir error en español y salir con código 1
- [ ] **4.4** Actualizar `jarvis refine iterate`
  - [ ] 4.4.1 Tras guardar iteración, si `phase=discovery` y `countOpen>0`, añadir hint: "Hay N preguntas sin responder. Ejecuta `jarvis refine questions <thread>` y `jarvis refine answer <thread>` para avanzar a la fase de refinamiento."
- [ ] **4.5** Registrar subcomandos en `packages/cli/src/index.ts`
  - [ ] 4.5.1 Añadir `discover`, `questions`, `answer` como subcomandos del comando `refine`
- [ ] **4.6** Build CLI
  - [ ] 4.6.1 `pnpm nx build @jarvis/cli` sin errores TypeScript

**CHECKPOINT 3: `pnpm nx build @jarvis/cli` pasa. `pnpm nx test @jarvis/cli` pasa.**

---

## Fase 5 — Docs & Sync

- [ ] **5.1** Actualizar `packages/docs/mcp-instructions.md`
  - [ ] 5.1.1 Añadir sección "Flujo de 2 fases" con diagrama ASCII: `discover → ingest_questions → answer_questions → requirements(refinement) → finalize`
  - [ ] 5.1.2 Documentar formato `[Ax]/[Mx]` con ejemplo de output del LLM
  - [ ] 5.1.3 Documentar `force_phase='refinement'` como escape-hatch con cuándo usarlo
  - [ ] 5.1.4 Documentar las 3 tools nuevas con descripción, params y ejemplo de llamada
- [ ] **5.2** Actualizar catálogo en `packages/core/jarvis-knowledge.ts`
  - [ ] 5.2.1 Registrar `refine_discover`, `refine_ingest_questions`, `refine_answer_questions` en el catálogo de tools
  - [ ] 5.2.2 Actualizar descripción de `refine_requirements` para mencionar los 2 modos y `force_phase`
- [ ] **5.3** Verificar sync y doctor
  - [ ] 5.3.1 `jarvis mcp sync --dry-run` — sin errores; catálogo refleja las 3 tools nuevas
  - [ ] 5.3.2 `jarvis mcp sync --check` — sin drift
  - [ ] 5.3.3 `jarvis doctor` — sin warnings relacionados a refine

---

## Fase 6 — Verify E2E

- [ ] **6.1** Ejecutar los 15 escenarios del spec contra DB temporal (in-memory o archivo tmp)
  - [ ] 6.1.1 GF-E1: iteración inicial con thread_id → prompt solo discovery
  - [ ] 6.1.2 GF-E2: ingest persiste 3 filas con `answer=NULL`
  - [ ] 6.1.3 GF-E3: respuesta parcial → `phase` queda `discovery`
  - [ ] 6.1.4 GF-E4: responder todas → siguiente `save` marca `phase='refinement'`
  - [ ] 6.1.5 GF-E5: `phase=refinement` → prompt con `### Resolved Context`
  - [ ] 6.1.6 GF-E6: `refine_finalize` rechaza con preguntas abiertas
  - [ ] 6.1.7 GF-E7: `force_phase=refinement` omite gating
  - [ ] 6.1.8 GF-E8: ingest sin markers → error
  - [ ] 6.1.9 GF-E9: path legacy sin thread_id → prompt idéntico al pre-gating
  - [ ] 6.1.10 GF-E10: CLI answer → imprime resumen correcto
  - [ ] 6.1.11 GF-E11: label inexistente → error controlado
  - [ ] 6.1.12 GF-E12: reingest mismo label → upsert, no duplicado
  - [ ] 6.1.13 GF-E13: prompt de discovery contiene runbook auto-contenido (header meta, preguntas listadas, tool calls con `thread_id` literal, prohibiciones explícitas)
  - [ ] 6.1.14 GF-E14: `refine_get_questions` devuelve `{open, answered, counts}` correctos sin mutar DB
  - [ ] 6.1.15 GF-E15: iterar en discovery (answer + requirements) no crea filas nuevas en `refinements`
- [ ] **6.2** Regression tests — paquetes afectados
  - [ ] 6.2.1 `pnpm nx test @jarvis/storage` — suite completa (incluyendo tests pre-existentes)
  - [ ] 6.2.2 `pnpm nx test @jarvis/tools-refine` — suite completa
  - [ ] 6.2.3 `pnpm nx build @jarvis/cli` — build limpio
  - [ ] 6.2.4 `pnpm nx build @jarvis/mcp` — build limpio (sin regresiones por tipos nuevos)
- [ ] **6.3** Validar migración aditiva sobre DB con datos pre-existentes
  - [ ] 6.3.1 Crear DB con filas en `refinements` sin columna `phase`, aplicar migration, verificar `DEFAULT 'discovery'` en filas viejas
  - [ ] 6.3.2 Verificar que `refine_finalize` no bloquea hilo pre-existente con `phase='discovery'` y `countOpen=0`

**CHECKPOINT 4: Todos los tests en verde. Los 12 escenarios GF-E1..GF-E12 pasan. Builds limpios en storage, tools-refine, cli, mcp.**
