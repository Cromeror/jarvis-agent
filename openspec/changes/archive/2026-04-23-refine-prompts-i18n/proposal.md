# Proposal — refine-prompts-i18n

## 1. Intent

Los prompts que generan las 4 tools prompt-builder del skill `refine` están hardcodeados en inglés, mientras que las descripciones MCP, el proyecto y la interacción con el user son en español. Esto provoca:

- **Output inconsistente**: el LLM downstream responde a veces en inglés (por los headers del prompt) y a veces en español (por el input del user), generando mezcla de idiomas.
- **Confusión para agentes nuevos**: la descripción MCP en español no avisa que el contenido del prompt está en inglés ni que el tool NO ejecuta LLM (solo devuelve scaffold).
- **Tokens adicionales**: el LLM gasta contexto traduciendo "Acceptance Criteria" a "Criterios de Aceptación" implícitamente.
- **Revisión humana degradada**: PMs/líderes de proyecto hispanohablantes leen un scaffold mezclado.

Este cambio unifica el idioma de los prompts a **español**, aclara en la descripción MCP que son prompt-builders (no ejecutores), y agrega una sección `### Tu Tarea` al inicio de cada prompt para que el agente invocador sepa que debe generar las secciones pedidas.

## 2. Scope

### In-scope

1. **Traducir al español** el contenido de los prompts generados por las 4 tools prompt-builder:
   - `refine_requirements` (one-shot + iterativo).
   - `check_definition_of_ready`.
   - `generate_user_stories`.
   - `identify_dependencies`.
2. **Aclarar en la descripción MCP** de las 4 tools que son prompt-builders (devuelven un prompt para que el agente lo ejecute, no ejecutan LLM).
3. **Traducir los `description` del `input_schema`** (strings como `"The raw requirements text to refine"`) al español.
4. **Agregar sección `### Tu Tarea`** al inicio de cada prompt con instrucción explícita al agente de qué hacer.
5. **Actualizar tests** que asertan strings en inglés.

### Out-of-scope

- **Header `<!-- refine:meta -->`**: queda en inglés. Es metadata técnica (no prosa), parseada con regex por CLI y agentes.
- **Términos técnicos**: **SMART** (acrónimo inglés estándar), **Given/When/Then** (formato BDD internacional), **Must/Should/Could/Won't Have** (MoSCoW) — se mantienen en inglés.
- **Param `output_language`**: no se introduce. Un solo idioma (español) para simplicidad.
- **Traducir las tools de persistencia** (`refine_save_iteration`, `refine_list_iterations`, `refine_get_latest`, `refine_finalize`): esas no generan prompts, retornan JSON. Ya están en español en la descripción.
- **Tocar `mcp-instructions.md` u otros docs**: ya están en español y consistentes.

## 3. Approach

Cambio puramente de strings, sin cambios de lógica. Archivo principal: `packages/tools/refine/src/index.ts`.

### Traducción decidida

**Títulos y secciones:**
| Inglés | Español |
|--------|---------|
| `## Requirements Refinement Analysis` | `## Análisis de Refinamiento de Requerimientos` |
| `### Input Requirements` | `### Requerimientos de Entrada` |
| `### Previous Output` | `### Output Previo` |
| `### Correction Instructions` | `### Instrucciones de Corrección` |
| `### Refinement Instructions` | `### Instrucciones de Refinamiento` |
| `## Definition of Ready Check` | `## Verificación de Definition of Ready` |
| `### Ticket Description` | `### Descripción del Ticket` |
| `### DoR Criteria to Evaluate` | `### Criterios de DoR a Evaluar` |
| `### Instructions` | `### Instrucciones` |
| `## User Story Generation` | `## Generación de Historias de Usuario` |
| `### Feature Description` | `### Descripción del Feature` |
| `## Dependency Analysis` | `## Análisis de Dependencias` |
| `### Requirements` | `### Requerimientos` |
| `#### Technical Dependencies` | `#### Dependencias Técnicas` |
| `#### Functional Dependencies` | `#### Dependencias Funcionales` |
| `#### Team Dependencies` | `#### Dependencias de Equipo` |
| `#### Risk Assessment` | `#### Evaluación de Riesgo` |

**Secciones de output (las 5 de `refine_requirements`):**
| Inglés | Español |
|--------|---------|
| Clarified Requirements | Requerimientos Clarificados |
| Ambiguities Identified | Ambigüedades Identificadas |
| Missing Information | Información Faltante |
| Edge Cases | Casos Límite |
| Acceptance Criteria | Criterios de Aceptación |

**Nueva sección `### Tu Tarea`** al inicio de cada prompt (ver spec.md para texto exacto).

### Archivos afectados

- `packages/tools/refine/src/index.ts` — 4 tools, ~120 líneas de strings.
- `packages/tools/refine/src/__tests__/refine-requirements.spec.ts` — ~8 assertions a actualizar.
- `packages/tools/refine/src/__tests__/refine-storage-tools.spec.ts` — revisar si hay assertions sobre prompts (no debería; ese suite es sobre persistencia).

Post-cambio requiere `jarvis mcp sync` para propagar descripciones nuevas al catálogo.

## 4. Key decisions

| Decisión | Elección | Racional |
|----------|----------|----------|
| Idioma del prompt | Español | Proyecto hispanohablante; output coherente con input del user. |
| Header meta | Mantener en inglés | Metadata técnica, no prosa. Parseada por regex. |
| Términos técnicos (SMART, Given/When/Then) | En inglés | Acrónimos/formatos internacionales reconocidos por el LLM. |
| Param `output_language` | No introducir | Agrega complejidad sin beneficio claro. Un solo idioma. |
| Sección `### Tu Tarea` | Agregar al inicio | Redundancia defensiva: incluso si agente ignora descripción MCP, ve la instrucción inline. |
| Descripción MCP | Explicitar "prompt-builder, no ejecuta LLM" | Clarificación central; evita el pattern de "el generador remoto no responde" que ya se observó en lx. |
| SDD vs. commit directo | SDD ligero | Cambio chico pero toca contrato con agentes; trazabilidad deseable. |

## 5. Affected packages

- `packages/tools/refine` — strings + tests.
- `packages/core` — catálogo regenerado automáticamente (sin cambios manuales).

Post-deploy: `jarvis mcp sync` para que clientes MCP (Claude Desktop, etc.) vean las descripciones actualizadas.

## 6. Risks & rollback

### Riesgos

1. **Agentes externos con prompts hardcodeados esperando strings en inglés**: si algún consumidor parsea los títulos del output del LLM con regex en inglés, se rompe. Mitigación: buscar en el repo si hay parseos de ese tipo. El header meta (sí parseado) no se toca.
2. **LLMs más chicos (Haiku, Qwen) pueden perder ~2% de calidad con prompts en español**: aceptado. Claude Sonnet/Opus no muestra diferencia material.
3. **Tokens +30% en el prompt**: real pero chico (~50-80 tokens sobre ~200). Centavos por iteración.

### Rollback

`git revert` del commit. Los prompts vuelven a inglés, tests vuelven a sus asserts originales. Sin migración ni datos afectados.

## 7. Non-goals

- No cambiar la lógica del skill.
- No cambiar el header meta.
- No agregar nuevas tools.
- No tocar otras skills del repo (jira, n8n, code — tienen sus propios prompts).
- No introducir internacionalización parametrizada.
