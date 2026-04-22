# Design — refine-prompts-i18n

## 1. Contexto

Cambio puramente de strings en `packages/tools/refine/src/index.ts`. Sin impacto arquitectónico. Sin migración de datos. Sin breaking changes de tipo ni de API.

## 2. Decisiones de diseño

### D1 — Un solo idioma (español), no parametrizado

**Alternativa considerada**: agregar un parámetro `output_language: 'en' | 'es'` al input schema de cada tool y emitir strings según el valor.

**Decisión**: rechazada. Razones:
- Duplica strings en el código (dos templates por tool).
- Agrega superficie de API sin caso de uso real (todo el proyecto es hispanohablante).
- El LLM downstream siempre puede traducir output si lo necesita.
- Simplificar primero, parametrizar solo si aparece un caso concreto.

### D2 — Header meta preservado en inglés

**Problema**: el header `<!-- refine:meta thread_id: ... -->` tiene campos técnicos (`thread_id`, `iteration`). Si traducimos esos nombres de campo, rompemos:
- La regex del CLI en [packages/cli/src/commands/refine.ts](../../../packages/cli/src/commands/refine.ts) que extrae UUID (`/<!-- refine:meta\s*\n\s*thread_id:\s*(\S+)/`).
- Cualquier parser externo de agentes MCP.

**Decisión**: el header queda intacto. Es metadata, no prosa.

### D3 — Términos técnicos internacionales se mantienen

Se mantienen en inglés:
- `SMART` — acrónimo reconocido globalmente.
- `Given/When/Then` — sintaxis BDD estándar.
- `Must Have / Should Have / Could Have / Won't Have` — MoSCoW prioritization, más común en inglés incluso en equipos hispanohablantes.
- `Story Points` — término de Scrum sin traducción consolidada.
- `PASS / FAIL / PARTIAL / READY / NOT READY` — tags para parseo downstream, mantener consistencia.

**Racional**: traducir estos términos introduce ruido sin valor. El equipo hispanohablante los reconoce en inglés.

### D4 — Sección `### Tu Tarea` como primera sección del body

**Problema**: el pattern observado en lx (agente dice "el generador remoto no responde") sugiere que agentes nuevos no saben que la tool es un prompt-builder.

**Decisión**: agregar `### Tu Tarea` al inicio de cada body (después del header meta). Triple redundancia con:
1. Descripción MCP que explicita "NO ejecuta LLM".
2. `### Tu Tarea` inline en el prompt.
3. `### Instrucciones de Refinamiento` (u equivalente) con pedido específico de secciones.

Si el agente falla a nivel de descripción MCP, lo atrapa la sección inline.

### D5 — Texto de `### Tu Tarea`

Tono claro, imperativo, en tuteo (consistente con el resto del proyecto en `CLAUDE.md`):

```
### Tu Tarea

Sos el analizador. Usando el contenido abajo, generá las secciones pedidas en
**### Instrucciones de Refinamiento**. No repitas el scaffold — reemplazá cada
ítem numerado con tu análisis real. Respondé en español.
```

Para `refine_requirements` adicionalmente se agrega una línea sobre la persistencia:

```
Después de generar el análisis, el agente orquestador debe llamar
refine_save_iteration(thread_id, output) con tu respuesta.
```

### D6 — Descripciones MCP — estructura común

Todas las descripciones de las 4 prompt-builder deben empezar con:

> "Genera un prompt estructurado de {propósito}. **Esta tool NO ejecuta el análisis** — devuelve un scaffold que el agente invocador debe procesar con su propio LLM..."

Mantener `refine_requirements` con el resto de su descripción actual (flujo iterativo, thread_id, etc.).

### D7 — Assertions en tests: buscar por strings en español

Los tests existentes tienen asserts como `toContain('## Requirements Refinement Analysis')`. Se reemplazan por el equivalente español. No se agregan tests nuevos específicos de i18n — los escenarios S1-S5 del spec están cubiertos por los tests actualizados.

### D8 — Versiones de implementación

**Fases**:
1. Traducir descripciones MCP e input schemas.
2. Traducir prompts de las 4 tools + agregar `### Tu Tarea`.
3. Actualizar tests.
4. Build + regression.

Cada fase independiente; orden recomendado para minimizar fallos intermedios.

## 3. Interfaces

### Ejemplo: prompt iterativo de `refine_requirements` post-cambio

```
<!-- refine:meta
thread_id: 550e8400-e29b-41d4-a716-446655440000
iteration: 2
-->

### Tu Tarea

Sos el analizador. Usando el contenido abajo, generá las secciones pedidas en
**### Instrucciones de Refinamiento**. No repitas el scaffold — reemplazá cada
ítem numerado con tu análisis real. Respondé en español.

Después de generar el análisis, el agente orquestador debe llamar
refine_save_iteration(thread_id, output) con tu respuesta.

## Análisis de Refinamiento de Requerimientos

### Output Previo
<texto del output anterior guardado>

### Instrucciones de Corrección
<correcciones del user>

{rulesSection si hay}

### Instrucciones de Refinamiento
Analizá los requerimientos anteriores y entregá:

1. **Requerimientos Clarificados** — Reescribí cada requerimiento para que sea específico, medible, alcanzable, relevante y acotado en el tiempo (SMART).
2. **Ambigüedades Identificadas** — Listá cualquier declaración vaga o contradictoria que requiera clarificación.
3. **Información Faltante** — Identificá qué información falta para especificar los requerimientos completamente.
4. **Casos Límite** — Destacá posibles casos límite que deben ser considerados.
5. **Criterios de Aceptación** — Para cada requerimiento refinado, sugerí criterios de aceptación claros.
```

### Ejemplo: descripción MCP post-cambio de `refine_requirements`

> "Genera un prompt estructurado de refinamiento de requerimientos contra reglas del proyecto. **Esta tool NO ejecuta el análisis** — devuelve un scaffold que el agente invocador debe procesar con su propio LLM, produciendo las 5 secciones listadas (Requerimientos Clarificados, Ambigüedades, Información Faltante, Casos Límite, Criterios de Aceptación). Para iterar: pasá `thread_id` (UUID) y opcionalmente `instructions` con las correcciones del user y/o `previous_output` con el texto a re-refinar. Si no pasás `previous_output`, el tool carga automáticamente el último output guardado del hilo. Si omitís `thread_id`, el tool genera uno nuevo y lo incluye en un header HTML (`<!-- refine:meta thread_id: … iteration: … -->`) al principio de la respuesta — extraelo para llamadas siguientes. Este tool NO persiste: después de mostrar el resultado al user y obtener aprobación, llamá `refine_save_iteration` con `thread_id` + `output`. Cuando el user confirme que está listo, llamá `refine_finalize`."

## 4. Testing strategy

- **Unit tests existentes**: actualizar asserts a strings en español (archivos `refine-requirements.spec.ts`, posiblemente `refine-storage-tools.spec.ts`).
- **No se agregan tests nuevos**: los escenarios S1-S5 del spec están cubiertos por los tests actualizados de cada tool.
- **Regression**: `pnpm nx test @jarvis/tools-refine` + builds de paquetes dependientes (`@jarvis/mcp`, `@jarvis/cli`).

## 5. Rollout

### Orden de ejecución

1. **Fase 1** — Descripciones MCP e input schemas (4 tools).
2. **Fase 2** — Prompts de las 4 tools + sección `### Tu Tarea`.
3. **Fase 3** — Actualizar tests.
4. **Fase 4** — Build + verify + `jarvis mcp sync`.

### Rollback

`git revert` del commit. Los prompts vuelven a inglés, tests vuelven a sus asserts originales. Catálogo MCP se re-sincroniza al siguiente `jarvis mcp sync`.

## 6. Open questions

Ninguna.
