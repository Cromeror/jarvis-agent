# Spec (delta) — refine-gated-flow

## 1. Resumen

Este delta introduce un *gating* de dos fases en el flujo de refinamiento con `thread_id`. Cuando un hilo está en `phase='discovery'`, `refine_requirements` emite solo instrucciones para identificar ambigüedades e información faltante (formato `[Ax]/[Mx]`), sin el bloque `### Refinement Instructions`. Una vez que el caller persiste las preguntas vía `refine_ingest_questions` y las responde todas con `refine_answer_questions`, la siguiente iteración avanza a `phase='refinement'` e incorpora `### Resolved Context` con el Q&A como contexto. Se agregan tres tools nuevas, una tabla nueva `refinement_questions`, una columna `phase` en `refinements`, y tres subcomandos CLI. El path legacy (sin `thread_id`) no cambia.

---

## 2. Requerimientos ADDED

**R-GF1.** `refine_requirements` MUST evaluar `phase` de la última iteración del thread en cada llamada. Si `phase='discovery'` y existen preguntas sin respuesta (`answer IS NULL`) y no hay `force_phase='refinement'`, el prompt MUST incluir solo instrucciones de discovery (listar ambigüedades y missing info con tags `[Ax]/[Mx]`) y NO MUST incluir el bloque `### Refinement Instructions`.

**R-GF1b.** El prompt de discovery emitido por `refine_requirements` MUST ser auto-contenido y actuar como runbook para el LLM. En particular MUST incluir, además del requerimiento y las reglas: (i) el `thread_id` literal, (ii) el número de iteración próxima, (iii) el conteo de preguntas abiertas y respondidas, (iv) la lista completa de preguntas abiertas con su `label`, `type` y `question`, (v) la lista completa de preguntas respondidas con su `label`, `question` y `answer`, (vi) instrucciones paso a paso que describan los caminos posibles (responder, agregar nuevas, avanzar a refinement) con los nombres exactos de las tools a invocar (`refine_answer_questions`, `refine_ingest_questions`, `refine_requirements`) y sus argumentos con el `thread_id` literal, (vii) prohibiciones explícitas (no escribir SMART/AC, no inventar respuestas, no reusar labels).

**R-GF2.** Si `phase='refinement'` (o si se pasó `force_phase='refinement'`), `refine_requirements` MUST incluir una sección `### Resolved Context` con todas las Q&A cerradas del thread, ubicada antes de `### Refinement Instructions`. MUST además instruir al LLM que, si encuentra nuevas ambigüedades durante el análisis, agregue preguntas `[Ax]/[Mx]` nuevas vía `refine_ingest_questions` (volviendo el thread a discovery). Cuando `force_phase='refinement'` y existen preguntas abiertas, el prompt MUST incluir una sección `### ⚠️ Preguntas NO resueltas` listándolas.

**R-GF3.** `refine_discover(thread_id, requirements, project_id?)` MUST emitir un prompt enfocado exclusivamente en identificar ambigüedades y missing info, indicando al LLM que responda solo con ítems en formato `[Ax] <pregunta>` / `[Mx] <pregunta>`, sin incluir SMART, edge cases ni AC. Este prompt es el emitido por `refine_requirements` en fase discovery; `refine_discover` es el entrypoint explícito para iniciar esa fase sin pasar por `refine_requirements`.

**R-GF3b.** Una tool nueva `refine_get_questions(thread_id)` MUST existir como entrypoint de solo lectura del estado de preguntas del hilo. MUST devolver un objeto con `open: RefinementQuestionRow[]`, `answered: RefinementQuestionRow[]`, y `counts: { open: number, answered: number }`. Esta tool permite al LLM consultar el estado sin re-emitir el prompt completo.

**R-GF4.** `refine_ingest_questions(thread_id, iteration, llm_response)` MUST parsear el texto recibido usando la regex `/^\[([AM])(\d+)\]\s+(.+)$/m` (tolerante a espacios y texto adicional), validar que los labels sean únicos dentro de la misma iteration, persistir cada match como fila en `refinement_questions` con `answer=NULL`, y devolver la lista estructurada de preguntas extraídas.

**R-GF5.** `refine_ingest_questions` MUST fallar con error "No se extrajeron preguntas del texto recibido" si el parse no encuentra al menos 1 ítem `[Ax]/[Mx]`. Esto es señal de drift del LLM.

**R-GF6.** `refine_ingest_questions` MUST ser idempotente por label en la misma iteration: si un label ya existe en esa iteration, MUST hacer upsert (actualizar `question`), no insertar duplicado. Esto permite reintentar el ingreso sin efectos colaterales.

**R-GF7.** `refine_answer_questions(thread_id, answers: {label, answer}[])` MUST aceptar múltiples pares `{label, answer}` en una sola llamada. Para cada par, MUST validar que el label exista en el thread; si no existe, MUST retornar error "Etiqueta \<label\> no existe en el hilo". MUST actualizar `answer` y `answered_at` para cada label válido.

**R-GF8.** Cuando `refine_answer_questions` deja el thread con `COUNT(answer IS NULL) = 0`, la próxima iteración creada vía `refine_save_iteration` MUST tener `phase='refinement'`.

**R-GF9.** `refine_save_iteration` MUST asignar `phase` siguiendo esta política: `'discovery'` por defecto; `'refinement'` solo si todas las preguntas del thread están respondidas (`COUNT(answer IS NULL) = 0`) o si el caller pasó `force_phase='refinement'` a `refine_requirements` en esa llamada.

**R-GF10.** `refine_finalize` MUST rechazar con error en español si la última iteración tiene `phase='discovery'` y existen preguntas abiertas. Mensaje sugerido: "No se puede finalizar el hilo: hay preguntas sin responder. Usa `jarvis refine answer <thread>` para responderlas o `force_phase=refinement` para omitir la validación." Excepción: si el thread ya está en `status='final'`, la operación es idempotente (sin error).

**R-GF11.** El CLI MUST exponer los siguientes subcomandos nuevos, con todos los mensajes al usuario en español:

| Subcomando | Descripción |
|---|---|
| `jarvis refine discover <thread?>` | Llama a `refine_discover` y muestra el prompt generado |
| `jarvis refine questions <thread>` | Lista preguntas con estado (respondida / pendiente) |
| `jarvis refine answer <thread> -q label=texto` | Llama a `refine_answer_questions`; `-q` es repetible |

**R-GF12.** El flag `-q` de `jarvis refine answer` MUST aceptar la forma `LABEL="texto con espacios"` y ser repetible en la misma invocación (ej. `-q A1="sí incluye QR" -q M2="COP y USD"`).

---

## 3. Requerimientos MODIFIED

**R1 (modificado).** `refine_requirements` MUST aceptar el parámetro opcional adicional `force_phase?: 'refinement'`. Cuando está presente, el gating de discovery se omite y el prompt se construye en modo refinement aunque existan preguntas abiertas.

**R4 (reafirmado, sin cambios de comportamiento).** Si no se proporciona `thread_id`, `refine_requirements` SHALL comportarse exactamente igual que en la versión actual. La columna `phase` y la tabla `refinement_questions` no se consultan ni se escriben en este path.

**R8 (modificado).** `refine_finalize` MUST, además de cambiar `status='final'`, verificar que la última iteración no esté en `phase='discovery'` con preguntas abiertas antes de finalizar. El guard se omite si el thread ya está en `status='final'` (idempotencia).

**R12 (modificado).** Las cuatro tools nuevas (`refine_discover`, `refine_ingest_questions`, `refine_answer_questions`, `refine_get_questions`) MUST registrarse en el array `tools[]` de `createRefineSkill` y MUST ser enrutadas desde el bloque `switch` en `execute` por nombre.

---

## 4. Requerimientos no funcionales ADDED

**R-GF-NF1.** La tabla `refinement_questions` MUST crearse con `CREATE TABLE IF NOT EXISTS`. La columna `phase` en `refinements` MUST agregarse con `ALTER TABLE refinements ADD COLUMN phase TEXT NOT NULL DEFAULT 'discovery' CHECK(phase IN ('discovery','refinement'))` dentro de un bloque `try/catch` (patrón aditivo existente en `database.ts`). Ninguna migración puede ser destructiva.

**R-GF-NF2.** El parser de `[Ax]/[Mx]` MUST usar la regex `/^\[([AM])(\d+)\]\s+(.+)$/m`. MUST ser tolerante a espacios, saltos de línea y texto adicional alrededor del marcador. MUST ser strict sobre el formato del label (solo `A` o `M` seguido de dígitos).

**R-GF-NF3.** Todas las queries de `refinement_questions` MUST ser síncronas y usar prepared statements. No se permite concatenación de strings SQL.

---

## 5. Escenarios (Given/When/Then)

**GF-E1 — Iteración inicial con thread_id → solo discovery**
- Given: no existe ninguna fila para `thread_id = "abc"`
- When: el caller llama a `refine_requirements(requirements, thread_id: "abc")`
- Then: el prompt devuelto contiene instrucciones de discovery con formato `[Ax]/[Mx]` y NO contiene el bloque `### Refinement Instructions`

**GF-E2 — LLM devuelve preguntas tagueadas → ingest persiste 3 filas**
- Given: existe una iteración `iteration=1` para `thread_id = "abc"` en `phase='discovery'`
- When: el caller llama a `refine_ingest_questions("abc", 1, "[A1] ¿Qué monedas acepta?\n[M1] ¿Aplica a usuarios invitados?\n[M2] ¿Qué ocurre al vencer la sesión?")`
- Then: se insertan 3 filas en `refinement_questions` con `answer=NULL`; la función devuelve lista con labels `A1`, `M1`, `M2`

**GF-E3 — Respuesta parcial → phase queda en discovery**
- Given: existen preguntas `A1`, `M1`, `M2` con `answer=NULL` para `thread_id = "abc"`
- When: el caller llama a `refine_answer_questions("abc", [{label: "A1", answer: "COP y USD"}])`
- Then: `A1` queda con `answer` y `answered_at` actualizados; `M1` y `M2` siguen con `answer=NULL`; `phase` no cambia

**GF-E4 — Responder todas → siguiente save marca phase=refinement**
- Given: solo queda `M2` sin responder en `thread_id = "abc"`
- When: el caller llama a `refine_answer_questions("abc", [{label: "M2", answer: "sesión expira y redirige al login"}])` y luego a `refine_save_iteration("abc", ...)`
- Then: `COUNT(answer IS NULL) = 0`; la fila insertada por `save` tiene `phase='refinement'`

**GF-E5 — Phase=refinement → prompt incluye Resolved Context**
- Given: la última iteración de `thread_id = "abc"` tiene `phase='refinement'`; existen 3 Q&A cerradas
- When: el caller llama a `refine_requirements(requirements, thread_id: "abc")`
- Then: el prompt contiene la sección `### Resolved Context` con las 3 Q&A y contiene el bloque `### Refinement Instructions`

**GF-E6 — refine_finalize rechaza hilo con preguntas abiertas**
- Given: la última iteración de `thread_id = "abc"` tiene `phase='discovery'` con 2 preguntas sin responder
- When: el caller llama a `refine_finalize("abc")`
- Then: la operación falla con mensaje en español indicando que hay preguntas sin responder y sugiriendo `jarvis refine answer` o `force_phase=refinement`

**GF-E7 — force_phase=refinement omite el gating de discovery**
- Given: la última iteración de `thread_id = "abc"` tiene `phase='discovery'` con preguntas abiertas
- When: el caller llama a `refine_requirements(requirements, thread_id: "abc", force_phase: 'refinement')`
- Then: el prompt se construye en modo refinement e incluye `### Refinement Instructions` (las Q&A abiertas se incluyen igualmente en `### Resolved Context` con `answer=NULL` marcado)

**GF-E8 — ingest sin preguntas válidas → error**
- Given: cualquier estado de `thread_id = "abc"`
- When: el caller llama a `refine_ingest_questions("abc", 1, "Aquí hay un resumen sin marcadores especiales.")`
- Then: la tool retorna error "No se extrajeron preguntas del texto recibido"

**GF-E9 — Path legacy sin thread_id → sin cambios**
- Given: la DB tiene filas para otros threads; no se pasa `thread_id`
- When: el caller llama a `refine_requirements(requirements)` sin `thread_id`
- Then: el prompt es idéntico al comportamiento pre-gating; no se lee ni escribe en `refinements` ni en `refinement_questions`

**GF-E10 — CLI answer → imprime resumen de respuestas**
- Given: `thread_id = "abc"` tiene preguntas `A1` y `M1` pendientes
- When: el usuario ejecuta `jarvis refine answer abc -q A1="sí incluye QR" -q M1="no aplica"`
- Then: el CLI aplica ambas respuestas y muestra en español: "Respuestas aplicadas: A1, M1. Preguntas pendientes: 0."

**GF-E11 — Responder label inexistente → error controlado**
- Given: `thread_id = "abc"` tiene solo preguntas `A1` y `M1`
- When: el caller llama a `refine_answer_questions("abc", [{label: "Z9", answer: "algo"}])`
- Then: la tool retorna error "Etiqueta Z9 no existe en el hilo"

**GF-E12 — refine_ingest_questions idempotente por label**
- Given: ya existe `label='A1'` en `iteration=1` de `thread_id = "abc"` con `question="¿Aplica QR?"`
- When: el caller llama de nuevo a `refine_ingest_questions("abc", 1, "[A1] ¿Aplica código QR o NFC?")`
- Then: no se inserta una fila duplicada; la fila existente se actualiza con la nueva `question`; el resultado devuelve 1 ítem

**GF-E13 — Prompt de discovery contiene runbook auto-contenido**
- Given: `thread_id = "abc"` tiene 2 preguntas abiertas (`A1`, `M1`) y 1 respondida (`A2`)
- When: el caller llama a `refine_requirements(requirements, thread_id: "abc")`
- Then: el prompt incluye (i) el header meta con `thread_id: abc`, `phase: discovery`, `open_questions: 2`, `answered_questions: 1`, (ii) la lista de preguntas abiertas con cada `[label]`, (iii) la lista de preguntas respondidas con `question` y `answer`, (iv) instrucciones que mencionan explícitamente las tool calls `refine_answer_questions(thread_id: "abc", …)`, `refine_ingest_questions(thread_id: "abc", …)` y `refine_requirements(thread_id: "abc", …)` con el `thread_id` literal en cada una, (v) la prohibición explícita de escribir SMART/AC/edge cases

**GF-E14 — refine_get_questions devuelve estado estructurado**
- Given: `thread_id = "abc"` tiene 2 preguntas abiertas y 1 respondida
- When: el caller llama a `refine_get_questions("abc")`
- Then: la tool devuelve `{ open: [2 rows], answered: [1 row], counts: { open: 2, answered: 1 } }` sin modificar estado

**GF-E15 — Iterar en discovery es responder, no llamar save**
- Given: `thread_id = "abc"` está en `phase='discovery'` con `A1`, `M1` abiertas
- When: el caller llama a `refine_answer_questions("abc", [{label: "A1", answer: "sí"}])` y luego a `refine_requirements(requirements, thread_id: "abc")` (sin `refine_save_iteration` en el medio)
- Then: la segunda llamada a `refine_requirements` devuelve nuevamente un prompt de discovery mostrando `A1` como respondida y `M1` todavía abierta; no se creó una fila nueva en `refinements`. El `save` solo se invoca cuando hay un *output* de refinement que persistir.

---

## 6. Edge cases / invariantes

- Responder un label ya respondido: `refine_answer_questions` MUST sobreescribir `answer` y `answered_at`. No es error; permite correcciones.
- Label duplicado en el mismo texto de ingest (ej. `[A1]` aparece dos veces): el parser MUST tomar solo la primera ocurrencia e ignorar duplicados del mismo label en el mismo texto.
- `answer` vacía string (`""`): MUST persistirse como `NULL` en DB para evitar falsos positivos de "pregunta respondida".
- Respuesta multi-línea en CLI: `-q A1="línea uno\nlínea dos"` MUST aceptarse; el valor se pasa tal cual al repo.
- Thread con una sola pregunta: el flujo completo (discover → ingest → answer → phase=refinement) MUST funcionar igual que con N preguntas.
- `refine_finalize` sobre hilo ya en `status='final'` MUST ser idempotente: sin error, sin doble escritura.
- Columna `phase` en filas pre-existentes (antes de la migración): el `DEFAULT 'discovery'` del `ALTER TABLE` las deja en `discovery`; como no tienen preguntas en `refinement_questions`, `COUNT(answer IS NULL) = 0` → las siguientes iteraciones pueden ser `refinement` sin bloqueo.
