# Tasks — refine-prompts-i18n

## Fase 1 — Descripciones MCP + input schemas

Archivo único: [packages/tools/refine/src/index.ts](../../../packages/tools/refine/src/index.ts).

- [x] **1.1** `refine_requirements` — actualizar descripción MCP (líneas 8-9)
  - [x] 1.1.1 Arrancar la descripción con: `"Genera un prompt estructurado de refinamiento de requerimientos contra reglas del proyecto. **Esta tool NO ejecuta el análisis** — devuelve un scaffold que el agente invocador debe procesar con su propio LLM, produciendo las 5 secciones listadas (Requerimientos Clarificados, Ambigüedades, Información Faltante, Casos Límite, Criterios de Aceptación)."`
  - [x] 1.1.2 Mantener el resto de la descripción actual (flujo iterativo + persistencia).

- [x] **1.2** `refine_requirements` — traducir `description` de cada prop en `input_schema.properties` (líneas 15-33)
  - [x] 1.2.1 `requirements.description`: `"Texto crudo de los requerimientos a refinar"`.
  - [x] 1.2.2 `project_id.description`: `"Project ID opcional para cargar reglas específicas del proyecto"`.
  - [x] 1.2.3 `thread_id.description`: `"Thread ID opcional para refinamiento iterativo. Si se provee, el tool carga el último output guardado como contexto."`.
  - [x] 1.2.4 `instructions.description`: `"Instrucciones de corrección opcionales del user para esta iteración."`.
  - [x] 1.2.5 `previous_output.description`: `"Output previo explícito opcional a usar como contexto, anulando lo que está en DB."`.

- [x] **1.3** `check_definition_of_ready` — actualizar descripción MCP (línea 40)
  - [x] 1.3.1 Reemplazar `"Checks a ticket description against the Definition of Ready rules for a project"` por: `"Genera un prompt para verificar una descripción de ticket contra las reglas de Definition of Ready del proyecto. **Esta tool NO ejecuta el análisis** — devuelve un scaffold que el agente invocador debe procesar con su propio LLM."`.
  - [x] 1.3.2 `ticket_description.description`: `"Descripción del ticket a evaluar"`.
  - [x] 1.3.3 `project_id.description`: `"Project ID opcional para cargar reglas de DoR"`.

- [x] **1.4** `generate_user_stories` — actualizar descripción MCP (línea 59)
  - [x] 1.4.1 Reemplazar por: `"Genera un prompt para descomponer una descripción de feature en historias de usuario bien estructuradas. **Esta tool NO ejecuta el análisis** — devuelve un scaffold que el agente invocador debe procesar con su propio LLM."`.
  - [x] 1.4.2 `feature_description.description`: `"Descripción del feature o épica a descomponer en historias de usuario"`.
  - [x] 1.4.3 `project_id.description`: `"Project ID opcional para cargar reglas específicas del proyecto"`.

- [x] **1.5** `identify_dependencies` — actualizar descripción MCP (línea 78)
  - [x] 1.5.1 Reemplazar por: `"Genera un prompt para identificar dependencias técnicas y funcionales en un conjunto de requerimientos. **Esta tool NO ejecuta el análisis** — devuelve un scaffold que el agente invocador debe procesar con su propio LLM."`.
  - [x] 1.5.2 `requirements.description`: `"Texto de requerimientos a analizar en busca de dependencias"`.
  - [x] 1.5.3 `project_id.description`: `"Project ID opcional para cargar reglas específicas del proyecto"`.

---

## Fase 2 — Traducir prompts + agregar `### Tu Tarea`

### 2.1 `refine_requirements` — path one-shot (líneas 192-216)

- [x] 2.1.1 Antes del título del análisis, agregar sección:
  ```
  ### Tu Tarea
  
  Sos el analizador. Usando el contenido abajo, generá las secciones pedidas en **### Instrucciones de Refinamiento**. No repitas el scaffold — reemplazá cada ítem numerado con tu análisis real. Respondé en español.
  
  Después de generar el análisis, el agente orquestador debe llamar refine_save_iteration(thread_id, output) con tu respuesta.
  
  ```
- [x] 2.1.2 Reemplazar `## Requirements Refinement Analysis` por `## Análisis de Refinamiento de Requerimientos`.
- [x] 2.1.3 Reemplazar `### Input Requirements` por `### Requerimientos de Entrada`.
- [x] 2.1.4 Reemplazar `### Refinement Instructions` por `### Instrucciones de Refinamiento`.
- [x] 2.1.5 Reemplazar `Please analyze the requirements above and provide:` por `Analizá los requerimientos anteriores y entregá:`.
- [x] 2.1.6 Reemplazar las 5 instrucciones numeradas:
  1. `**Requerimientos Clarificados** — Reescribí cada requerimiento para que sea específico, medible, alcanzable, relevante y acotado en el tiempo (SMART).`
  2. `**Ambigüedades Identificadas** — Listá cualquier declaración vaga o contradictoria que requiera clarificación.`
  3. `**Información Faltante** — Identificá qué información falta para especificar los requerimientos completamente.`
  4. `**Casos Límite** — Destacá posibles casos límite que deben ser considerados.`
  5. `**Criterios de Aceptación** — Para cada requerimiento refinado, sugerí criterios de aceptación claros.`

### 2.2 `refine_requirements` — path iterativo (líneas 228-267)

- [x] 2.2.1 Agregar `### Tu Tarea` análoga al one-shot, con mismo texto.
- [x] 2.2.2 Reemplazar `## Requirements Refinement Analysis` por `## Análisis de Refinamiento de Requerimientos`.
- [x] 2.2.3 Reemplazar `### Previous Output` por `### Output Previo`.
- [x] 2.2.4 Reemplazar `### Correction Instructions` por `### Instrucciones de Corrección`.
- [x] 2.2.5 Reemplazar `### Refinement Instructions` por `### Instrucciones de Refinamiento`.
- [x] 2.2.6 Reemplazar las 5 instrucciones numeradas (mismo texto que 2.1.6).

### 2.3 `check_definition_of_ready` (líneas 273-308)

- [x] 2.3.1 Agregar sección `### Tu Tarea`:
  ```
  ### Tu Tarea
  
  Sos el evaluador. Analizá la descripción del ticket abajo contra los criterios de DoR y respondé en español con el formato indicado en **### Instrucciones**. No repitas el scaffold.
  
  ```
- [x] 2.3.2 Reemplazar `## Definition of Ready Check` por `## Verificación de Definition of Ready`.
- [x] 2.3.3 Reemplazar `### Ticket Description` por `### Descripción del Ticket`.
- [x] 2.3.4 Reemplazar `### DoR Criteria to Evaluate` por `### Criterios de DoR a Evaluar`.
- [x] 2.3.5 Reemplazar `### Instructions` por `### Instrucciones`.
- [x] 2.3.6 Traducir el bloque de instrucciones (mantener tags `PASS/FAIL/PARTIAL/READY/NOT READY` en inglés):
  - `Para cada criterio listado, determiná si la descripción del ticket lo satisface.`
  - `Respondé con:`
  - `- ✅ PASS — el criterio se cumple claramente`
  - `- ❌ FAIL — el criterio no se cumple (explicá qué falta)`
  - `- ⚠️ PARTIAL — el criterio se cumple parcialmente (explicá qué necesita mejorar)`
  - `Concluí con un veredicto general **READY** o **NOT READY** y una lista de cambios requeridos.`
- [x] 2.3.7 Traducir los 8 criterios default (`defaultDorCriteria` en líneas 276-285):
  - `- Resumen claro y conciso que describa el trabajo`
  - `- Descripción detallada que explique el problema o feature`
  - `- Criterios de aceptación específicos y testeables`
  - `- Estimación en story points provista`
  - `- Nivel de prioridad definido`
  - `- Sin dependencias bloqueantes sin resolver`
  - `- Asignado al componente/equipo correcto`
  - `- Revisado y aprobado por el product owner`

### 2.4 `generate_user_stories` (líneas 311-343)

- [x] 2.4.1 Agregar sección `### Tu Tarea`:
  ```
  ### Tu Tarea
  
  Sos el generador de historias de usuario. Usando la descripción del feature abajo, producí historias siguiendo el formato y criterios indicados en **### Instrucciones**. No repitas el scaffold. Respondé en español.
  
  ```
- [x] 2.4.2 Reemplazar `## User Story Generation` por `## Generación de Historias de Usuario`.
- [x] 2.4.3 Reemplazar `### Feature Description` por `### Descripción del Feature`.
- [x] 2.4.4 Reemplazar `### Instructions` por `### Instrucciones`.
- [x] 2.4.5 Traducir el bloque principal (formato de historia, Given/When/Then, MoSCoW, INVEST):
  - `Descompone la descripción del feature en historias de usuario individuales siguiendo el formato estándar:`
  - `**Como** [tipo de usuario], **quiero** [objetivo], **para que** [beneficio].`
  - `Para cada historia, además entregá:`
  - `- **Criterios de Aceptación** (formato Given/When/Then)`
  - `- **Story Points** (estimación: 1, 2, 3, 5, 8, 13)`
  - `- **Prioridad** (Must Have / Should Have / Could Have / Won't Have)`
  - `- **Dependencias** (otras historias de las que depende)`
  - `Apuntá a historias que sean:`
  - `- **Independientes** — se pueden desarrollar y liberar independientemente`
  - `- **Negociables** — los detalles pueden discutirse`
  - `- **Valiosas** — entregan valor al usuario final`
  - `- **Estimables** — el equipo puede estimar el esfuerzo`
  - `- **Pequeñas** — entran en un sprint`
  - `- **Testeables** — tienen criterios de aceptación claros`

### 2.5 `identify_dependencies` (líneas 345-382)

- [x] 2.5.1 Agregar sección `### Tu Tarea`:
  ```
  ### Tu Tarea
  
  Sos el analizador de dependencias. Usando los requerimientos abajo, identificá y categorizá todas las dependencias siguiendo el formato de **### Instrucciones**. No repitas el scaffold. Respondé en español.
  
  ```
- [x] 2.5.2 Reemplazar `## Dependency Analysis` por `## Análisis de Dependencias`.
- [x] 2.5.3 Reemplazar `### Requirements` por `### Requerimientos`.
- [x] 2.5.4 Reemplazar `### Instructions` por `### Instrucciones`.
- [x] 2.5.5 Traducir instrucción de categorización: `Analizá los requerimientos anteriores e identificá todas las dependencias. Categorizalas como:`.
- [x] 2.5.6 Reemplazar categorías y bullets:
  - `#### Dependencias Técnicas`
    - `- Servicios o APIs externos requeridos`
    - `- Librerías, frameworks o herramientas necesarias`
    - `- Requerimientos de infraestructura o plataforma`
    - `- Cambios de schema de base de datos`
  - `#### Dependencias Funcionales`
    - `- Features o capacidades que deben existir antes de implementar esto`
    - `- Datos que deben estar disponibles o migrados`
    - `- Procesos de negocio que deben estar en su lugar`
  - `#### Dependencias de Equipo`
    - `- Otros equipos que deben entregar trabajo primero`
    - `- Expertos de dominio o aprobaciones requeridas`
  - `#### Evaluación de Riesgo`
  - `Para cada dependencia, evaluá:`
    - `- **Impacto**: Alto / Medio / Bajo (qué pasa si no se resuelve)`
    - `- **Probabilidad**: Alta / Media / Baja (chance de que la dependencia cause demora)`
    - `- **Mitigación**: Acción sugerida para resolver la dependencia`

---

## Fase 3 — Tests

### 3.1 `packages/tools/refine/src/__tests__/refine-requirements.spec.ts`

- [x] 3.1.1 Línea 22: `toContain('## Requirements Refinement Analysis')` → `toContain('## Análisis de Refinamiento de Requerimientos')`.
- [x] 3.1.2 Línea 78: misma sustitución (empty string thread_id test).
- [x] 3.1.3 Línea 133: `toContain('### Refinement Instructions')` → `toContain('### Instrucciones de Refinamiento')`.
- [x] 3.1.4 Línea 153: `toContain('## Requirements Refinement Analysis')` → nuevo valor.
- [x] 3.1.5 Línea 165: `toContain('### Correction Instructions')` → `toContain('### Instrucciones de Corrección')`.
- [x] 3.1.6 Línea 178: `not.toContain('### Correction Instructions')` → `not.toContain('### Instrucciones de Corrección')`.
- [x] 3.1.7 Buscar otros asserts sobre strings en inglés que hayan quedado (por si la exploración anterior omitió alguno). — Se encontró y corrigió línea con `### Previous Output` → `### Output Previo` (x3), `### Input Requirements` → `### Requerimientos de Entrada`.

### 3.2 `packages/tools/refine/src/__tests__/refine-storage-tools.spec.ts`

- [x] 3.2.1 Revisar si hay asserts sobre contenido del prompt. No hay — solo assertea sobre JSON de storage rows. Sin cambios necesarios.

### 3.3 Agregar tests mínimos de cobertura (opcional)

- [ ] 3.3.1 Agregar test: one-shot contiene `### Tu Tarea` y `## Análisis de Refinamiento de Requerimientos`.
- [ ] 3.3.2 Agregar test: `check_definition_of_ready` contiene `### Tu Tarea` y `## Verificación de Definition of Ready`.
- [ ] 3.3.3 Agregar test: `generate_user_stories` contiene `### Tu Tarea` y `## Generación de Historias de Usuario`.
- [ ] 3.3.4 Agregar test: `identify_dependencies` contiene `### Tu Tarea` y `## Análisis de Dependencias`.

---

## Fase 4 — Build y Verify

- [x] **4.1** `pnpm nx build @jarvis/storage` (dependencia). — verde (cache hit)
- [x] **4.2** `pnpm nx build @jarvis/tools-refine`. — verde
- [x] **4.3** `pnpm nx test @jarvis/tools-refine` — verde (24/24 tests).
- [x] **4.4** `pnpm nx build @jarvis/cli` — verde.
- [x] **4.5** `pnpm nx build @jarvis/mcp` — verde.
- [ ] **4.6** Verificar que la regex del CLI sigue funcionando con el nuevo header (smoke test manual o inspección del header emitido).

**CHECKPOINT:** Todos los builds verdes, tests verdes.

---

## Fase 5 — Cleanup y commit

- [ ] **5.1** `jarvis mcp sync --dry-run` (si está disponible) — verificar que refleja descripciones actualizadas.
- [ ] **5.2** Commit en rama actual con mensaje descriptivo.
- [ ] **5.3** Actualizar `packages/docs/refine-flow.md` si es apropiado (sección de seguimiento).
