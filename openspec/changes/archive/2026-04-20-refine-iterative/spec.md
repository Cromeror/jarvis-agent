# Spec — refine-iterative

## 1. Resumen

Se agrega persistencia opcional a `refine_requirements`: cuando el caller proporciona un `thread_id`, el sistema puede almacenar cada salida como una iteración numerada en la tabla `refinements`, permitiendo que las llamadas sucesivas al tool recuperen automáticamente el output anterior y construyan el prompt con contexto acumulado. La tool en sí sigue siendo pura (no persiste); cuatro tools nuevas (`refine_save_iteration`, `refine_list_iterations`, `refine_get_latest`, `refine_finalize`) son responsables de la persistencia y del ciclo de vida del hilo. Un nuevo grupo CLI `jarvis refine` expone estas operaciones en español.

---

## 2. Requerimientos funcionales

**R1.** `refine_requirements` MUST aceptar los parámetros opcionales `thread_id`, `instructions` y `previous_output` además de los existentes, sin alterar el comportamiento cuando ninguno está presente.

**R2.** Si se proporciona `previous_output` explícito, `refine_requirements` MUST usar ese valor como contexto previo, ignorando la base de datos.

**R3.** Si se proporciona `thread_id` pero no `previous_output`, `refine_requirements` MUST consultar `refine_get_latest(thread_id)` y usar el `output` de esa fila como contexto previo; si no existe ninguna iteración, MUST tratar la llamada como iteración inicial (sin contexto).

**R4.** Si no se proporciona `thread_id`, `refine_requirements` SHALL comportarse exactamente igual que en la versión actual (sin consultar ni escribir en la base de datos).

**R5.** `refine_save_iteration` MUST insertar una fila en `refinements` con `thread_id`, `iteration_number`, `requirements`, `instructions` (nullable), `output` y `status = 'draft'`; `iteration_number` MUST ser `MAX(iteration_number) + 1` calculado dentro de una transacción.

**R6.** `refine_list_iterations` MUST devolver todas las filas de un `thread_id` ordenadas por `iteration_number` ascendente; si el hilo no existe MUST devolver lista vacía sin error.

**R7.** `refine_get_latest` MUST devolver la fila con el `iteration_number` más alto para el `thread_id` dado; si no existe ninguna fila MUST devolver `null` o un error controlado (no excepción no manejada).

**R8.** `refine_finalize` MUST actualizar `status = 'final'` en todas las filas del `thread_id` indicado.

**R9.** Después de `refine_finalize`, cualquier llamada a `refine_save_iteration` sobre ese `thread_id` MUST fallar con un mensaje de error claro.

**R10.** Después de `refine_finalize`, `refine_requirements` con ese `thread_id` SHOULD emitir una advertencia al caller (comportamiento: warn pasivo en el prompt, no error fatal).

**R11.** Cada fila en `refinements` MUST persistir el campo `instructions` junto con `output` (puede ser `NULL` si no se proveyeron instrucciones).

**R12.** Las cuatro tools nuevas MUST registrarse en el array `tools[]` de `createRefineSkill` y MUST ser enrutadas desde `execute` con `switch` por nombre.

**R13.** El CLI MUST exponer el grupo `jarvis refine` con los subcomandos `save`, `iterate`, `list`, `show` y `finalize`; todos los mensajes al usuario MUST estar en español.

---

## 3. Requerimientos no funcionales

**R-NF1.** Todas las operaciones de base de datos MUST ser síncronas usando `better-sqlite3` (sin async/await en el repo).

**R-NF2.** El repositorio MUST usar prepared statements en todas las queries; no se permite concatenación de strings SQL.

**R-NF3.** El schema MUST ser aditivo: `CREATE TABLE IF NOT EXISTS refinements (...)` sin `DROP` ni `ALTER` destructivo.

**R-NF4.** Después del deploy, el operador MUST ejecutar `jarvis mcp sync` para actualizar el catálogo de tools en `CLAUDE.md`; esto MUST estar documentado en `packages/docs/mcp-instructions.md`.

**R-NF5.** `RefinementRow` MUST definirse en `packages/storage/src/types.ts` con tipos TypeScript strict (`string | null` para campos opcionales).

---

## 4. Escenarios (Given/When/Then)

**E1 — Primera iteración con thread_id, save explícito**
- Given: no existe ninguna fila para `thread_id = "abc"`
- When: el caller llama a `refine_requirements(requirements, thread_id: "abc")` y luego a `refine_save_iteration(thread_id: "abc", requirements, output)`
- Then: se inserta una fila con `iteration_number = 1`, `status = 'draft'`, `instructions = NULL`

**E2 — Segunda iteración con instructions**
- Given: existe una fila `iteration_number = 1` para `thread_id = "abc"` con `output = "output-1"`
- When: el caller llama a `refine_requirements(requirements, thread_id: "abc", instructions: "más conciso")` (sin `previous_output`)
- Then: el prompt incluye `output-1` como contexto previo y "más conciso" como instrucción; tras el save se inserta `iteration_number = 2`, `instructions = "más conciso"`

**E3 — previous_output explícito anula DB**
- Given: existe una fila `iteration_number = 2` para `thread_id = "abc"` con `output = "output-2"`
- When: el caller llama a `refine_requirements(requirements, thread_id: "abc", previous_output: "override")`
- Then: el prompt usa `"override"` como contexto previo, ignorando `output-2` de la DB

**E4 — Comportamiento legacy sin thread_id**
- Given: la DB tiene filas para otros threads
- When: el caller llama a `refine_requirements(requirements)` sin `thread_id`
- Then: el tool devuelve un prompt idéntico al comportamiento actual; no se lee ni escribe ninguna fila en `refinements`

**E5 — save bloqueado tras finalize**
- Given: `thread_id = "xyz"` está en `status = 'final'`
- When: el caller llama a `refine_save_iteration(thread_id: "xyz", ...)`
- Then: el tool devuelve un error con mensaje "El hilo xyz ya está finalizado y no admite nuevas iteraciones"

**E6 — refine_requirements advierte sobre hilo finalizado**
- Given: `thread_id = "xyz"` está en `status = 'final'`
- When: el caller llama a `refine_requirements(requirements, thread_id: "xyz")`
- Then: el prompt se construye normalmente (usando el último output como contexto) pero incluye una advertencia al inicio: "Advertencia: el hilo xyz ya fue finalizado. El output no debería guardarse."

**E7 — list sobre hilo inexistente**
- Given: no existe ninguna fila para `thread_id = "nope"`
- When: el caller llama a `refine_list_iterations(thread_id: "nope")`
- Then: el tool devuelve una lista vacía `[]` sin lanzar excepción

**E8 — get_latest sobre hilo inexistente**
- Given: no existe ninguna fila para `thread_id = "nope"`
- When: el caller llama a `refine_get_latest(thread_id: "nope")`
- Then: el tool devuelve `null` (o un objeto con `found: false`) sin lanzar excepción

**E9 — CLI jarvis refine iterate**
- Given: existe al menos una iteración para `thread_id = "abc"`
- When: el usuario ejecuta `jarvis refine iterate abc -m "hazlo más breve"`
- Then: el CLI llama internamente a `refine_requirements` con `thread_id = "abc"` e `instructions = "hazlo más breve"`, imprime el prompt generado y los IDs (`thread_id`, `iteration_number` sugerido) en español

**E10 — Concurrencia: iteration_number monotónico**
- Given: existe una fila `iteration_number = 1` para `thread_id = "abc"`
- When: dos llamadas concurrentes a `refine_save_iteration(thread_id: "abc", ...)` se ejecutan simultáneamente
- Then: `better-sqlite3` serializa las escrituras; cada insert calcula `MAX(iteration_number) + 1` dentro de su transacción; los `iteration_number` resultantes son 2 y 3 (no duplicados)

---

## 5. Edge cases / invariantes

- `thread_id` vacío string (`""`) MUST tratarse igual que `thread_id` ausente (comportamiento legacy).
- `instructions` vacía string (`""`) MUST persistirse como `NULL` en la DB para evitar ruido en el historial.
- `previous_output` muy largo: el tool no valida longitud; es responsabilidad del LLM caller no exceder el contexto del modelo destino.
- Llamar a `refine_finalize` sobre un hilo ya finalizado MUST ser idempotente (no error, no doble-escritura con efecto).
- Llamar a `refine_finalize` sobre un `thread_id` inexistente MUST devolver error controlado: "No se encontraron iteraciones para el hilo indicado."
- `iteration_number` MUST ser siempre mayor que cero; la primera iteración es `1`.
- El repo no expone `DELETE`; las filas en `refinements` son inmutables una vez insertadas (excepto el campo `status`).
