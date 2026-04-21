# Design — refine-gated-flow

## 1. Arquitectura

```
                              ┌──────────────────────────────┐
                              │ refine_requirements(thread)  │
                              │ resolveEffectivePhase(thread)│
                              └──────┬────────────────┬──────┘
                                     │                │
                           phase=discovery     phase=refinement
                                     │                │
                                     ▼                ▼
                          ┌────────────────┐  ┌───────────────────┐
                          │ discoveryPrompt│  │ refinementPrompt  │
                          │ (solo [Ax]/[Mx]│  │ SMART + AC + QA   │
                          └──────┬─────────┘  │ Resolved Context  │
                                 │            └──────▲────────────┘
                                 │                   │
                      LLM emite [A1]/[M1] list       │
                                 │                   │
                                 ▼                   │
                    ┌────────────────────────┐       │
                    │ refine_ingest_questions│──────►│ persist Q
                    │ parse + upsert         │       │
                    └──────┬─────────────────┘       │
                           │                         │
                           ▼                         │
                  ┌──────────────────────┐           │
                  │ refine_answer_       │──────────►│ persist A
                  │ questions (label,A)  │           │
                  └──────┬───────────────┘           │
                         │ countOpen==0              │
                         ▼                           │
                 ┌────────────────────┐              │
                 │ refine_save_       │──phase='ref'─┘
                 │ iteration          │
                 └────────────────────┘
                         │
                         ▼
                 ┌────────────────────┐
                 │ refine_finalize    │ (guard: phase=discovery + open>0 → reject)
                 └────────────────────┘

Storage:
  refinements (+ phase)
       │ 1                       N
       └──────► refinement_questions (label, type, question, answer?)
```

## 2. Esquema de base de datos

En `database.ts`, dentro del bloque `CREATE TABLE IF NOT EXISTS`, agregar la tabla nueva y los índices. La columna `phase` se añade vía migración aditiva con try/catch.

```sql
CREATE TABLE IF NOT EXISTS refinement_questions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  refinement_id  INTEGER NOT NULL REFERENCES refinements(id) ON DELETE CASCADE,
  thread_id      TEXT    NOT NULL,
  label          TEXT    NOT NULL,           -- 'A1','M2',…
  type           TEXT    NOT NULL CHECK(type IN ('ambiguity','missing')),
  question       TEXT    NOT NULL,
  answer         TEXT,
  answered_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(thread_id, label)
);

CREATE INDEX IF NOT EXISTS idx_refq_thread      ON refinement_questions(thread_id);
CREATE INDEX IF NOT EXISTS idx_refq_refinement  ON refinement_questions(refinement_id);
CREATE INDEX IF NOT EXISTS idx_refq_unanswered  ON refinement_questions(thread_id, answer) WHERE answer IS NULL;
```

Migración aditiva (sigue patrón de `ALTER TABLE project_rules ADD COLUMN tool_name`):

```ts
try { db.exec(`ALTER TABLE refinements ADD COLUMN phase TEXT NOT NULL DEFAULT 'discovery' CHECK(phase IN ('discovery','refinement'))`); } catch {}
```

Justificación: `UNIQUE(thread_id, label)` garantiza idempotencia en reingests (el LLM puede reemitir `[A1]` con wording corregido); `ON DELETE CASCADE` evita huérfanos si se decide borrar una iteración (fuera de scope, pero barato); el índice parcial acelera `countOpen` (query caliente en cada `refine_requirements`).

## 3. Interfaces TypeScript

Nuevas entradas en `packages/storage/src/types.ts`:

```ts
export interface RefinementQuestionRow {
  id: number;
  refinement_id: number;
  thread_id: string;
  label: string;
  type: 'ambiguity' | 'missing';
  question: string;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
}

export interface ParsedQuestion {
  label: string;
  type: 'ambiguity' | 'missing';
  question: string;
}
```

`RefinementRow` se extiende con `phase: 'discovery' | 'refinement'`.

Repo nuevo `packages/storage/src/repositories/refinement-questions.ts`:

```ts
export function createRefinementQuestionsRepo(db) {
  ingest(refinementId, threadId, parsed: ParsedQuestion[]): RefinementQuestionRow[]; // upsert ON CONFLICT(thread_id,label) DO UPDATE SET question=excluded.question
  listByThread(threadId): RefinementQuestionRow[];                                    // solo answered (answer IS NOT NULL), para "Resolved Context"
  listOpen(threadId): RefinementQuestionRow[];                                        // answer IS NULL
  countOpen(threadId): number;
  answer(threadId, label, answer): RefinementQuestionRow;                             // UPDATE SET answer=?, answered_at=datetime('now')
}
```

`Storage` interface suma `refinementQuestions: ReturnType<typeof createRefinementQuestionsRepo>`.

Input schemas JSON de las 4 tools nuevas (`refine_discover`, `refine_ingest_questions`, `refine_answer_questions`, `refine_get_questions`) y extensión de `refine_requirements` con `force_phase?: 'discovery' | 'refinement'`.

- `refine_get_questions(thread_id: string)` — return `{ open: RefinementQuestionRow[], answered: RefinementQuestionRow[], counts: { open: number, answered: number } }`. Read-only.

## 4. Parser de `[Ax]/[Mx]`

Regex multiline: `/^\[([AM])(\d+)\]\s+([\s\S]+?)(?=\n\[[AM]\d+\]|\n*$)/gm`.

Input:

```
[A1] ¿Las operaciones incluyen QR?
[M1] ¿Volumen esperado?
[A2] ¿Aplica a multi-MID?
```

Output: `[{type:'ambiguity',label:'A1',question:'¿Las operaciones incluyen QR?'}, ...]`.

Edge cases: se descarta whitespace inicial; preguntas multi-línea se capturan hasta el próximo marker `[Xn]`; todo texto fuera de los markers se ignora (comentarios del LLM). Si el parse devuelve `[]`, `refine_ingest_questions` lanza `No se extrajeron preguntas: revisar formato [Ax]/[Mx]`.

## 5. Flujos (pseudocódigo)

### `refine_requirements` (extendido)

```
phase = resolveEffectivePhase(threadId, force_phase)
openQs   = storage.refinementQuestions.listOpen(threadId)
closedQs = storage.refinementQuestions.listByThread(threadId)  // answered

if phase === 'discovery':
  // Iterar en discovery significa: el user/LLM ya respondió algunas preguntas pero quedan otras.
  // El prompt muestra estado parcial y exige seguir cerrando preguntas, no refinar.
  return discoveryPrompt(
    threadId, nextIter, requirements, rulesSection, instructions,
    openQs, closedQs
  )
else:
  // refinement: todas las preguntas cerradas (o force_phase). Ahora sí SMART/AC.
  return refinementPrompt(
    threadId, nextIter, requirements, rulesSection, instructions,
    closedQs, openQs  // openQs solo si force_phase; se marcan como no resueltas
  )

resolveEffectivePhase(threadId, force_phase):
  if force_phase: return force_phase
  lastPhase = storage.refinements.getLatest(threadId)?.phase ?? 'discovery'
  if lastPhase === 'discovery' AND storage.refinementQuestions.countOpen(threadId) === 0 AND has any Q:
      return 'refinement'   // auto-transición: preguntas resueltas, próximo save marcará phase
  return lastPhase
```

### `refine_discover`

Emite un prompt **auto-contenido** que le dice al LLM exactamente qué hacer, con qué tools y con qué `thread_id`. El LLM no tiene que adivinar el protocolo. Template (pseudocódigo, texto real en §10):

```
<!-- refine:meta
thread_id: {threadId}
iteration: {nextIter}
phase: discovery
open_questions: {countOpen}
-->

## Fase: Discovery — identificar ambigüedades e información faltante

### Requerimiento en análisis
{requirements}

{rulesSection ?? ''}

### Qué tenés que hacer
1. Leé el requerimiento y las reglas del proyecto.
2. Enumerá **solo** las ambigüedades (`[Ax]`) y la información faltante (`[Mx]`). No escribas criterios de aceptación, SMART, ni edge cases.
3. Formato estricto, una por línea: `[A1] pregunta`, `[M1] pregunta`. Texto adicional fuera de los markers será ignorado.
4. Cuando termines, persistí las preguntas llamando:
   `refine_ingest_questions(thread_id: "{threadId}", iteration: {nextIter}, llm_response: "<tu output>")`
5. Pedile al user las respuestas (o extraelas del contexto disponible) y registralas con:
   `refine_answer_questions(thread_id: "{threadId}", answers: [{label, answer}, …])`
6. Cuando `remaining === 0` en la respuesta de `refine_answer_questions`, volvé a llamar `refine_requirements(thread_id: "{threadId}", requirements: …)`: el prompt cambiará automáticamente a fase `refinement` y vas a poder emitir el análisis completo con los Q&A ya resueltos como contexto.

### Preguntas abiertas hasta ahora ({countOpen})
{openQuestions.forEach: "- [{label}] {question} — pendiente"}

### Preguntas ya respondidas ({countAnswered})
{answeredQuestions.forEach: "- [{label}] {question} → {answer}"}

### NO hagas
- NO escribas AC, SMART, edge cases ni refinamiento extendido en esta fase.
- NO inventes respuestas si no están en el contexto: preguntá al user.
- NO reutilices labels ya existentes con wording distinto: el reingest sobreescribe la pregunta. Si una pregunta cambió de sentido, usá un label nuevo (`A{next}`).
```

**Principio**: el prompt hace las veces de "runbook" para el LLM. Incluye `thread_id` literal, `iteration`, el contador de preguntas abiertas/cerradas, y las tool calls exactas que debe encadenar. Sin eso, el LLM no sabe que `refine_ingest_questions` y `refine_answer_questions` existen aunque estén en el catálogo.

### `refine_ingest_questions`

```
parsed = parseLabels(input.text)
if parsed.length === 0: throw Error('No se extrajeron preguntas')
latest = storage.refinements.getLatest(threadId)   // debe existir
rows = storage.refinementQuestions.ingest(latest.id, threadId, parsed)
return JSON.stringify(rows)
```

### `refine_answer_questions`

```
for {label, answer} of input.answers:
  storage.refinementQuestions.answer(threadId, label, answer)
return JSON.stringify({ answered: input.answers.length, remaining: storage.refinementQuestions.countOpen(threadId) })
```

### `refine_save_iteration` (modificado)

```
phase = (input.force_phase === 'refinement') ? 'refinement'
      : (storage.refinementQuestions.countOpen(threadId) === 0 && hasQuestions) ? 'refinement'
      : storage.refinements.getLatest(threadId)?.phase ?? 'discovery'
row = storage.refinements.save({ ...input, phase })
```

### `refine_finalize` (modificado)

```
latest = storage.refinements.getLatest(threadId)
if latest?.phase === 'discovery' AND storage.refinementQuestions.countOpen(threadId) > 0:
  throw Error('El hilo tiene N preguntas abiertas. Respondé con `jarvis refine answer` antes de finalizar.')
storage.refinements.finalize(threadId)
```

## 6. CLI

| Subcomando | Flags | Llama a | Output |
|---|---|---|---|
| `discover [thread?]` | `--input <file>`, `-p <proj>` | `refine_discover` → (opcional) `refine_ingest_questions` | prompt discovery; si `thread` ausente genera UUID |
| `questions <thread>` | — | listado directo del repo (`listByThread` + `listOpen`) | tabla `label │ type │ Q │ A?` |
| `answer <thread>` | `-q label=texto` (repeatable) | `refine_answer_questions` | "X respuestas aplicadas, Y pendientes" |

`iterate` ajusta su mensaje final: si `phase=discovery` con abiertas, sugiere `jarvis refine answer`. Si `phase=refinement`, comportamiento actual.

## 7. Tool descriptions (MCP) actualizadas

- **`refine_requirements`**: describe ambos modos (discovery emite preguntas `[Ax]/[Mx]`; refinement emite análisis SMART/AC con Q&A como contexto resuelto) y la auto-transición por `countOpen=0`.
- **`refine_discover`**: "Emite prompt de descubrimiento que pide al LLM listar ambigüedades y missing info tagueadas con `[Ax]/[Mx]`."
- **`refine_ingest_questions`**: "Parsea respuesta `[Ax]/[Mx]` del LLM y persiste las preguntas en el hilo. Idempotente por `(thread_id, label)`."
- **`refine_answer_questions`**: "Cierra preguntas del hilo aplicando respuestas `{label, text}[]`. Devuelve `{answered, remaining}`. Responder preguntas es iterar en discovery: NO hace falta llamar `refine_save_iteration` entre respuestas."
- **`refine_get_questions`**: "Devuelve el estado de preguntas del hilo sin modificarlo: `{open, answered, counts}`. Útil cuando el LLM necesita consultar qué quedó abierto sin regenerar el prompt completo."
- Skill description actualizada: menciona las 2 fases y las 4 tools nuevas, y aclara que **iterar en discovery = responder preguntas; iterar en refinement = emitir un nuevo output y llamarlo save**.

## 8. Decisiones

- **Auto-transición a `refinement`**: el próximo `refine_save_iteration` (cuando `countOpen=0` y hay al menos una pregunta registrada) es la ceremonia que fija `phase='refinement'`. No hay transición silenciosa sin save; esto mantiene `refinements` como fuente única de verdad auditable.
- **Idempotencia**: `ingest` usa `ON CONFLICT(thread_id, label) DO UPDATE SET question=excluded.question`; reingestar no duplica ni pierde la respuesta existente (solo re-escribe el texto de la pregunta).
- **Legacy path intacto**: sin `thread_id`, `refine_requirements` ignora fase y emite el prompt histórico de 5 items (R4 sigue válido).
- **Borrar iteraciones NO está en scope**: tabla Q&A no se purga; `ON DELETE CASCADE` queda para futuro.
- **`force_phase` como escape-hatch**: permite saltar discovery cuando el caller sabe que no aplica (ej. fix trivial).

## 9. Impactos cross-package

- **`@jarvis/storage`**: tabla nueva, columna nueva, repo nuevo, types nuevos.
- **`@jarvis/tools/refine`**: 3 tools nuevas, switch extendido, templates gateados (discovery vs refinement con `### Resolved Context`).
- **`@jarvis/cli`**: 3 subcomandos nuevos (`discover`, `questions`, `answer`) registrados en `index.ts` siguiendo el patrón de `project.ts`.
- **`@jarvis/core/jarvis-knowledge.ts`**: catálogo regenerado → `jarvis mcp sync` post-deploy (R-NF4).
- **`@jarvis/docs/mcp-instructions.md`**: documentar flujo de 2 fases y ejemplos de `[Ax]/[Mx]`.
- **Tests nuevos**: unitarios del parser (multi-línea, markers huérfanos, `count=0`), transición de `phase` (`save` con `countOpen=0`), gating de `finalize` (`phase=discovery` + abiertas → reject).

---

## 10. Templates literales del prompt

Estos son los strings exactos que genera `refine_requirements` según la fase. Ambos están pensados para que el LLM lea el prompt como un runbook: declara dónde está (thread, iteración, fase), qué tiene que emitir, y qué tool llamar a continuación.

### 10.1 Prompt de discovery (iteración 1 o siguientes con preguntas abiertas)

```
<!-- refine:meta
thread_id: {threadId}
iteration: {nextIter}
phase: discovery
open_questions: {openQs.length}
answered_questions: {closedQs.length}
-->

## Fase: Discovery — identificar y cerrar preguntas

> Estamos iterando sobre el hilo de refinamiento `{threadId}` (iteración próxima: `{nextIter}`).
> Todavía hay **{openQs.length} pregunta(s) abierta(s)**. En esta fase NO se refina:
> el único entregable válido es resolver las preguntas pendientes (o registrar nuevas si el contexto lo amerita).

### Requerimiento bajo análisis
{requirements}

{rulesSection}

{instructions ? "### Instrucciones de esta iteración\n" + instructions + "\n" : ""}

### Preguntas abiertas ({openQs.length})
{openQs.forEach: "- `[{label}]` ({type}) {question}"}

### Preguntas ya respondidas ({closedQs.length})
{closedQs.length === 0 ? "_Ninguna todavía._" :
 closedQs.forEach: "- `[{label}]` {question}\n  → {answer}"}

### Qué tenés que hacer ahora

Elegí **uno** de estos caminos según lo que el contexto te permita:

**Camino A — Responder preguntas abiertas** (preferido)
1. Para cada pregunta en "Preguntas abiertas" que puedas responder con la información disponible o preguntando al user, armá la lista de `{label, answer}` pairs.
2. Llamá:
   ```
   refine_answer_questions(
     thread_id: "{threadId}",
     answers: [{ label: "A1", answer: "..." }, …]
   )
   ```
3. La tool devuelve `{ answered, remaining }`. Si `remaining > 0`, repetí este paso con más respuestas; si `remaining === 0`, pasá al Camino C.

**Camino B — Agregar preguntas nuevas** (solo si detectás nuevas ambigüedades o información faltante NO listada arriba)
1. Emití nuevas líneas `[Ax]` / `[Mx]` con labels que NO colisionen con los existentes (el siguiente libre es `A{nextA}` / `M{nextM}`).
2. Pasá el texto completo (incluidas las preguntas abiertas existentes) a:
   ```
   refine_ingest_questions(
     thread_id: "{threadId}",
     iteration: {nextIter},
     llm_response: "<tu output>"
   )
   ```
3. Volvé a llamar `refine_requirements(thread_id: "{threadId}", requirements: …)` para refrescar el prompt.

**Camino C — Avanzar a refinement**
1. Cuando `remaining === 0` (todas las preguntas están respondidas), invocá:
   ```
   refine_requirements(thread_id: "{threadId}", requirements: "{requirements}")
   ```
2. El prompt cambiará a fase `refinement`. Recién ahí emitís SMART / AC / edge cases.

### Reglas estrictas
- NO escribas SMART, AC, edge cases ni análisis extendido en esta fase. Si lo hacés, estás violando el protocolo.
- NO inventes respuestas. Si no sabés, preguntale al user — no asumas.
- NO reuses labels existentes con wording distinto: el reingest sobreescribe la `question`. Si cambió de sentido, usá un label nuevo.
- Formato de respuesta al llamar `refine_answer_questions`: respuestas cortas y concretas. Una línea por respuesta, salvo que la pregunta requiera contexto.
```

### 10.2 Prompt de refinement (todas las preguntas cerradas o `force_phase`)

```
<!-- refine:meta
thread_id: {threadId}
iteration: {nextIter}
phase: refinement
answered_questions: {closedQs.length}
open_questions: {openQs.length}   -- solo > 0 si force_phase
-->

## Fase: Refinement — análisis completo con contexto resuelto

> Hilo `{threadId}`, iteración próxima `{nextIter}`.
> Las preguntas de discovery están cerradas. Ahora sí refinamos.

### Requerimiento original
{requirements}

{base ? "### Output de iteración anterior\n" + base + "\n" : ""}

{instructions ? "### Correcciones pedidas por el user\n" + instructions + "\n" : ""}

### Resolved Context ({closedQs.length} decisiones cerradas)
{closedQs.forEach: "- **[{label}]** {question}\n  → {answer}"}

{openQs.length > 0 ? "### ⚠️ Preguntas NO resueltas (force_phase activo)\n" + openQs.forEach: "- `[{label}]` {question}" : ""}

{rulesSection}

### Refinement Instructions
Aplicá el contexto resuelto arriba y producí:

1. **Clarified Requirements** — Reescribí cada requerimiento en formato SMART (Specific, Measurable, Achievable, Relevant, Time-bound).
2. **Acceptance Criteria** — Por cada requerimiento refinado, uno o más criterios en formato Given/When/Then.
3. **Edge Cases** — Casos borde que el Resolved Context deja entrever pero no cierra del todo.
4. **Implementation Notes** (opcional) — Dependencias técnicas, contratos de API, consideraciones de performance.

### Si encontrás nuevas ambigüedades durante el refinamiento
Volvé a Camino B del prompt de discovery: agregá `[Ax]`/`[Mx]` nuevos vía `refine_ingest_questions`. El siguiente `refine_requirements` volverá a fase discovery hasta cerrarlas.

### Cuando el output sea definitivo
1. Guardalo con `refine_save_iteration(thread_id: "{threadId}", output: "<texto>")`.
2. Si el user lo aprueba como final, cerrá el hilo: `refine_finalize(thread_id: "{threadId}")`.
```

### 10.3 Observaciones sobre los templates

- **`thread_id` siempre literal**: evita que el LLM tenga que recordarlo de turnos anteriores o parsear el header. Aparece en texto plano en cada tool call sugerida.
- **Contador de preguntas**: `open_questions` y `answered_questions` en el header son las mismas métricas que puede consultar `refine_get_questions` si la UI lo necesita; acá se inlinean para que el LLM no tenga que pedirlas aparte.
- **Multi-camino explícito**: el prompt de discovery da 3 caminos (A: responder, B: agregar, C: avanzar). Sin esa matriz, el LLM tiende a mezclar (responde + empieza a refinar en la misma respuesta) y rompe el gating.
- **Iterar en discovery**: queda explícito que responder preguntas ES iterar — no hay que ejecutar `refine_save_iteration` entre respuestas; el save se usa solo para persistir el *output* del refinement, no para marcar progreso del Q&A.

---

## Envelope

- **status**: ok
- **executive_summary**: Diseño del gating de dos fases (`discovery` → `refinement`) con tabla `refinement_questions` (FK a `refinements`, `UNIQUE(thread_id,label)`, índice parcial sobre unanswered), columna `phase` aditiva en `refinements`, parser regex `[Ax]/[Mx]` multi-línea idempotente, 3 tools nuevas (`refine_discover`, `refine_ingest_questions`, `refine_answer_questions`), extensión de `refine_requirements` con `force_phase`, gate en `refine_finalize`, y 3 subcomandos CLI. Auto-transición a `refinement` ocurre en el próximo `save` cuando `countOpen=0`.
- **artifacts**: openspec/changes/refine-gated-flow/design.md
- **next_recommended**: tasks
- **risks**: parser frágil si el LLM rompe formato (mitigado con error hard si `count=0`) · migración aditiva sin rollback formal (mitigado: `DROP TABLE refinement_questions` + mantener `phase`) · hilos pre-existentes en `phase='discovery'` sin preguntas registradas (mitigado: guard de `finalize` requiere `countOpen>0`, no solo `phase`) · concurrencia en `ingest` (serializada por better-sqlite3, idempotente por UNIQUE)
- **skill_resolution**: injected
