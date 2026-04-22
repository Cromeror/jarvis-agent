# Spec Delta — refine-prompts-i18n

Cambios sobre [`openspec/specs/refine/spec.md`](../../specs/refine/spec.md). Puramente de strings.

## Requirements

### R1 — Descripción MCP de las 4 tools prompt-builder explicita su naturaleza (REPLACE)

Las tools `refine_requirements`, `check_definition_of_ready`, `generate_user_stories`, `identify_dependencies` DEBEN tener en su campo `description` (schema MCP) una aclaración explícita en español que incluya:

1. Qué hace la tool (propósito funcional).
2. **Explicitar que devuelve un prompt estructurado, NO ejecuta LLM.** El agente invocador es responsable de generar las secciones pedidas.
3. Qué hacer con el output (para `refine_requirements`: persistir vía `refine_save_iteration`; las demás: devolver el análisis al user).

Ejemplo para `refine_requirements`:

> "Genera un prompt estructurado de refinamiento de requerimientos. **Esta tool NO ejecuta el análisis** — devuelve un scaffold que el agente invocador debe procesar con su propio LLM, produciendo las 5 secciones listadas. Después de generar el análisis, llamá `refine_save_iteration(thread_id, output)` para persistir. Para iterar: pasá `thread_id` ..."

### R2 — Descripciones de parámetros en `input_schema` en español (REPLACE)

Todos los campos `description` dentro de `input_schema.properties` de las 4 tools DEBEN estar en español. Cubre strings como `"The raw requirements text to refine"` → `"Texto crudo de los requerimientos a refinar"`, etc.

### R3 — Prompt de `refine_requirements` traducido (REPLACE)

El body generado por `refine_requirements` (ambos paths: one-shot e iterativo) DEBE emitir los siguientes títulos y strings en español:

| Inglés (actual) | Español (nuevo) |
|-----------------|------------------|
| `## Requirements Refinement Analysis` | `## Análisis de Refinamiento de Requerimientos` |
| `### Input Requirements` | `### Requerimientos de Entrada` |
| `### Previous Output` | `### Output Previo` |
| `### Correction Instructions` | `### Instrucciones de Corrección` |
| `### Refinement Instructions` | `### Instrucciones de Refinamiento` |

Las 5 instrucciones numeradas del bloque `### Instrucciones de Refinamiento`:

1. `**Requerimientos Clarificados** — Reescribí cada requerimiento para que sea específico, medible, alcanzable, relevante y acotado en el tiempo (SMART).`
2. `**Ambigüedades Identificadas** — Listá cualquier declaración vaga o contradictoria que requiera clarificación.`
3. `**Información Faltante** — Identificá qué información falta para especificar los requerimientos completamente.`
4. `**Casos Límite** — Destacá posibles casos límite que deben ser considerados.`
5. `**Criterios de Aceptación** — Para cada requerimiento refinado, sugerí criterios de aceptación claros.`

La línea de apertura de instrucciones (`"Please analyze the requirements above and provide:"`) se traduce a `"Analizá los requerimientos anteriores y entregá:"`.

El término **SMART** queda en inglés por ser acrónimo estándar.

### R4 — Prompt de `check_definition_of_ready` traducido (REPLACE)

El body generado DEBE emitir:

| Inglés (actual) | Español (nuevo) |
|-----------------|------------------|
| `## Definition of Ready Check` | `## Verificación de Definition of Ready` |
| `### Ticket Description` | `### Descripción del Ticket` |
| `### DoR Criteria to Evaluate` | `### Criterios de DoR a Evaluar` |
| `### Instructions` | `### Instrucciones` |

Bloque de instrucciones traducido:

> `Para cada criterio listado, determiná si la descripción del ticket lo satisface. Respondé con:`
> `- ✅ PASS — el criterio se cumple claramente`
> `- ❌ FAIL — el criterio no se cumple (explicá qué falta)`
> `- ⚠️ PARTIAL — el criterio se cumple parcialmente (explicá qué necesita mejorar)`
>
> `Concluí con un veredicto general **READY** o **NOT READY** y una lista de cambios requeridos.`

Los literales `PASS` / `FAIL` / `PARTIAL` / `READY` / `NOT READY` quedan en inglés (son tags estándar, fáciles de parsear y reconocibles).

**Criterios default** (cuando el proyecto no tiene reglas custom) — traducir los 8 bullets:

- `- Resumen claro y conciso que describa el trabajo`
- `- Descripción detallada que explique el problema o feature`
- `- Criterios de aceptación específicos y testeables`
- `- Estimación en story points provista`
- `- Nivel de prioridad definido`
- `- Sin dependencias bloqueantes sin resolver`
- `- Asignado al componente/equipo correcto`
- `- Revisado y aprobado por el product owner`

### R5 — Prompt de `generate_user_stories` traducido (REPLACE)

| Inglés | Español |
|--------|---------|
| `## User Story Generation` | `## Generación de Historias de Usuario` |
| `### Feature Description` | `### Descripción del Feature` |
| `### Instructions` | `### Instrucciones` |

Bloque principal:

> `Descompone la descripción del feature en historias de usuario individuales siguiendo el formato estándar:`
>
> `**Como** [tipo de usuario], **quiero** [objetivo], **para que** [beneficio].`
>
> `Para cada historia, además entregá:`
> - `**Criterios de Aceptación** (formato Given/When/Then)`
> - `**Story Points** (estimación: 1, 2, 3, 5, 8, 13)`
> - `**Prioridad** (Must Have / Should Have / Could Have / Won't Have)`
> - `**Dependencias** (otras historias de las que depende)`
>
> `Apuntá a historias que sean:`
> - `**Independientes** — se pueden desarrollar y liberar independientemente`
> - `**Negociables** — los detalles pueden discutirse`
> - `**Valiosas** — entregan valor al usuario final`
> - `**Estimables** — el equipo puede estimar el esfuerzo`
> - `**Pequeñas** — entran en un sprint`
> - `**Testeables** — tienen criterios de aceptación claros`

Los términos `Given/When/Then`, `Must Have / Should Have / Could Have / Won't Have`, `Story Points` quedan en inglés (formatos BDD/MoSCoW estándar).

### R6 — Prompt de `identify_dependencies` traducido (REPLACE)

| Inglés | Español |
|--------|---------|
| `## Dependency Analysis` | `## Análisis de Dependencias` |
| `### Requirements` | `### Requerimientos` |
| `### Instructions` | `### Instrucciones` |
| `#### Technical Dependencies` | `#### Dependencias Técnicas` |
| `#### Functional Dependencies` | `#### Dependencias Funcionales` |
| `#### Team Dependencies` | `#### Dependencias de Equipo` |
| `#### Risk Assessment` | `#### Evaluación de Riesgo` |

Bullets y campos del bloque `Risk Assessment`:

- `- **Impacto**: Alto / Medio / Bajo (qué pasa si no se resuelve)`
- `- **Probabilidad**: Alta / Media / Baja (chance de que la dependencia cause demora)`
- `- **Mitigación**: Acción sugerida para resolver la dependencia`

Los bullets de cada categoría (Technical/Functional/Team) se traducen a español manteniendo estructura.

### R7 — Sección `### Tu Tarea` al inicio de cada prompt (ADD)

Cada tool prompt-builder DEBE agregar al inicio del body generado (después del header meta cuando aplica) una sección `### Tu Tarea` con instrucción explícita al agente.

Texto base (adaptar por tool):

> `### Tu Tarea`
>
> `Sos el analizador. Usando el contenido abajo, generá las secciones pedidas en **### Instrucciones de Refinamiento** (u equivalente de la tool). No repitas el scaffold — reemplazá cada ítem numerado con tu análisis real. Respondé en español.`

Para `refine_requirements` adicionalmente:

> `Después de generar el análisis, el agente orquestador debe llamar refine_save_iteration(thread_id, output) con tu respuesta para persistir la iteración.`

### R8 — Tests actualizados (REPLACE)

Los tests en `packages/tools/refine/src/__tests__/refine-requirements.spec.ts` que asertan strings en inglés DEBEN actualizarse a los nuevos strings en español. Estos incluyen:

- `toContain('## Requirements Refinement Analysis')` → `toContain('## Análisis de Refinamiento de Requerimientos')`.
- `toContain('### Refinement Instructions')` → `toContain('### Instrucciones de Refinamiento')`.
- `toContain('### Correction Instructions')` → `toContain('### Instrucciones de Corrección')`.
- `not.toContain('### Correction Instructions')` → `not.toContain('### Instrucciones de Corrección')`.

### R9 — Header meta sin cambios (KEEP)

El header `<!-- refine:meta thread_id: ... iteration: ... -->` NO se traduce. Sigue siendo metadata técnica parseada por regex.

### R10 — Términos técnicos internacionales preservados (KEEP)

- `SMART` (acrónimo).
- `Given/When/Then` (BDD).
- `Must Have / Should Have / Could Have / Won't Have` (MoSCoW).
- `Story Points`.
- `PASS / FAIL / PARTIAL / READY / NOT READY` (tags de DoR).
- Nombres de tools MCP (`refine_save_iteration`, etc.).

## Scenarios

### S1 — One-shot genera prompt en español

**Given** agente llama `refine_requirements({ requirements: "quiero X" })` sin `thread_id`.
**When** la tool responde.
**Then** el body contiene:
- Header meta (inalterado).
- `### Tu Tarea` con instrucción en español.
- `## Análisis de Refinamiento de Requerimientos`.
- `### Requerimientos de Entrada` con el texto del user.
- `### Instrucciones de Refinamiento` con las 5 instrucciones en español (1. Requerimientos Clarificados, 2. Ambigüedades Identificadas, ...).
- NO contiene `"## Requirements Refinement Analysis"` ni `"### Refinement Instructions"`.

### S2 — Iterativo genera prompt en español

**Given** agente llama `refine_requirements` con `thread_id` existente.
**When** responde.
**Then** contiene secciones `### Output Previo` y `### Instrucciones de Corrección` (si aplica) en español. No contiene strings en inglés correspondientes.

### S3 — `check_definition_of_ready` en español

**Given** agente llama la tool con un ticket description.
**When** responde.
**Then** el body contiene `## Verificación de Definition of Ready`, `### Descripción del Ticket`, `### Criterios de DoR a Evaluar`, `### Instrucciones` en español. Los literales `PASS/FAIL/PARTIAL/READY/NOT READY` se mantienen en inglés.

### S4 — `generate_user_stories` en español

**Given** agente llama la tool con feature description.
**When** responde.
**Then** el body contiene `## Generación de Historias de Usuario`, `### Descripción del Feature` en español, formato `**Como** ... **quiero** ... **para que** ...`. `Given/When/Then` y MoSCoW quedan en inglés.

### S5 — `identify_dependencies` en español

**Given** agente llama la tool con requerimientos.
**When** responde.
**Then** contiene `## Análisis de Dependencias`, categorías `#### Dependencias Técnicas`, etc. `#### Evaluación de Riesgo` con campos `Impacto`, `Probabilidad`, `Mitigación` en español.

### S6 — Descripción MCP explicita "prompt-builder"

**Given** un cliente MCP lista las tools del skill refine.
**When** lee el `description` de las 4 tools prompt-builder.
**Then** cada descripción incluye una frase equivalente a "Esta tool NO ejecuta el análisis — devuelve un scaffold que el agente debe procesar".

### S7 — Header meta inalterado

**Given** one-shot genera prompt.
**When** el body se emite.
**Then** el header meta `<!-- refine:meta thread_id: ... iteration: ... -->` tiene formato idéntico al anterior (en inglés, parseable con la regex existente).

### S8 — Regex de extracción del CLI sigue funcionando

**Given** el CLI `jarvis refine iterate` sin `--thread` invoca la tool y parsea el header con `/<!-- refine:meta\s*\n\s*thread_id:\s*(\S+)/`.
**When** la tool retorna con el header traducido.
**Then** la regex extrae el UUID sin cambios.

### S9 — Tests actualizados pasan

**Given** suite `@jarvis/tools-refine`.
**When** se corre `pnpm nx test @jarvis/tools-refine`.
**Then** pasa en verde; las assertions actualizadas verifican strings en español.
