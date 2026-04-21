# Jarvis MCP — registro e instrucciones

Guía corta para usar Jarvis desde Claude Code en cualquier proyecto.

---

## Descripción general

Jarvis se registra como servidor MCP en Claude Code. Expone:

- `jarvis_chat` — delega al agent loop de Jarvis
- `jarvis_list_projects` — lista proyectos conocidos
- `jarvis_project_context` — stack, reglas e integraciones de un proyecto
- `jarvis_run_tool` — ejecuta una tool concreta (jira, refine, code, n8n)

Los dos archivos `CLAUDE.md` que Jarvis mantiene sincronizados le dicen a Claude Code **cuándo** invocarlo y **con qué `project_id`**.

---

## Comandos

```bash
jarvis mcp install            # Build + registra el MCP en Claude Code (scope user)
jarvis mcp update             # Rebuild + re-registra tras cambios en tools/server
jarvis mcp uninstall          # Quita el registro
jarvis mcp status             # Muestra el estado actual

jarvis mcp sync               # Actualiza bloque en ~/.claude/CLAUDE.md
jarvis mcp sync --project --project-id <id>
                              # Actualiza bloque en ./CLAUDE.md del proyecto actual
jarvis mcp sync --check       # Reporta drift sin escribir (exit 2 si hay drift)
jarvis mcp sync --dry-run     # Muestra la acción sin escribir
```

---

## Flujo típico

```bash
# 1. Provider de IA (una vez)
jarvis ai setup

# 2. Registrar MCP en Claude Code (una vez, scope user)
jarvis mcp install

# 3. Instrucciones globales (correr tras cambios en tools/providers)
jarvis mcp sync

# 4. En cada proyecto donde uses Jarvis
cd /ruta/al/proyecto
jarvis mcp sync --project --project-id <id>
```

---

## ¿Cuándo correr `sync`?

Es idempotente: si nada cambió, no escribe. Correlo cuando:

- Agregaste o modificaste una tool en Jarvis (`jarvis mcp update` + `sync`)
- Cambiaste integraciones del proyecto (`jarvis integration set ...`)
- Creaste un proyecto nuevo
- Cambiaste el provider de IA activo

Si no estás seguro, `jarvis doctor` te avisa si hay drift.

## Después de `jarvis mcp update`

Claude Code arranca el MCP como subprocess persistente por sesión. Los
cambios en `packages/mcp/dist/` no los toma hasta que **reinicies la
sesión de Claude Code** en los proyectos donde lo estés usando. Si ves
respuestas viejas o tools inventadas tras un update, la sesión está
usando el binario cacheado — reiniciala.

---

## Qué escribe `sync`

Un bloque delimitado en `CLAUDE.md`:

```markdown
<!-- JARVIS:BEGIN hash=a3f2... -->
...contenido generado...
<!-- JARVIS:END -->
```

Garantías:

- **Nunca duplica**: detecta el bloque y lo reemplaza
- **No toca texto fuera** del bloque
- **Skip si nada cambió**: compara hash, no reescribe
- **Falla explícito** si encuentra bloques malformados (no intenta "arreglar")

Si editás el bloque a mano, el próximo `sync` lo sobrescribe. Usá `--check` antes si querés validar.

---

## Integración con `jarvis doctor`

`jarvis doctor` corre un check de drift del bloque global. Sale con `warn` si:

- El bloque no existe → sugiere `jarvis mcp sync`
- El hash del bloque no coincide con el estado actual → sugiere `jarvis mcp sync`

---

## Flujo iterativo de refine

Las tools `refine_*` soportan un ciclo de refinamiento incremental donde cada iteración parte del output anterior:

```
refine_requirements (thread_id)
        |
        v
   user review
        |
   ¿Correcciones?
   /            \
  Sí             No
  |               |
  v               v
refine_requirements    refine_finalize
(thread_id +           (thread_id)
 instructions)
        |
        v
 refine_save_iteration
 (thread_id, output)
        |
        v
   (repetir)
```

### Usando el CLI

```bash
# Primera iteración (genera un nuevo thread_id automáticamente)
jarvis refine iterate --input /ruta/req.txt

# Guardar el output aprobado (copiar el thread_id del paso anterior)
jarvis refine save <thread_id> /ruta/output1.txt

# Segunda iteración con correcciones
jarvis refine iterate <thread_id> --input /ruta/req.txt --instructions "hazlo más breve"

# Ver todas las iteraciones del hilo
jarvis refine list <thread_id>

# Finalizar el hilo
jarvis refine finalize <thread_id>
```

### Usando MCP directamente

```jsonc
// Primera llamada — sin thread_id se genera uno nuevo
{ "tool": "refine_requirements", "input": { "requirements": "..." } }
// → Respuesta incluye header: <!-- refine:meta thread_id: <uuid> iteration: 1 -->

// Guardar output
{ "tool": "refine_save_iteration", "input": { "thread_id": "<uuid>", "output": "..." } }

// Segunda iteración con instrucciones de corrección
{
  "tool": "refine_requirements",
  "input": {
    "requirements": "...",
    "thread_id": "<uuid>",
    "instructions": "hazlo más breve"
  }
}

// Finalizar
{ "tool": "refine_finalize", "input": { "thread_id": "<uuid>" } }
```

### Notas importantes

- **`refine_requirements` sin `thread_id`**: genera automáticamente un `thread_id` UUID y retorna un header meta (`<!-- refine:meta thread_id: <uuid> iteration: 1 -->`) al inicio del prompt. No persiste nada en la base de datos — el `thread_id` es una "promesa de hilo" que se materializa cuando el agente llama a `refine_save_iteration`. Ideal para iniciar un ciclo de refinamiento sin necesidad de parámetros adicionales.
- **`previous_output` explícito**: si se pasa `previous_output` en la llamada, ese valor se usa como contexto previo ignorando lo que haya en la base de datos. Útil para casos donde el caller ya tiene el texto disponible en memoria.
- **Reapertura implícita**: cuando `refine_save_iteration` se invoca sobre un hilo cuyo status es `completed` (finalizado), la tool automáticamente reabre el hilo — todas las iteraciones transicionan de `completed` a `in_progress` y la nueva iteración se persiste con status `in_progress`, en una sola transacción. No hay tool separada ni error; es un comportamiento transparente que permite reanudar refinamientos tras finalizar.
- **Estados del hilo**: cada iteración tiene `status` que refleja el estado del hilo: `'in_progress'` (puede recibir nuevas iteraciones) o `'completed'` (finalizado, pero reabre si se persiste una nueva iteración).
- **Después de actualizar la tool o el catálogo** (por ejemplo, al agregar las nuevas tools `refine_*`), es **obligatorio** correr `jarvis mcp sync` y reiniciar la sesión de Claude Code. Sin este paso, Claude Code usará el catálogo desactualizado y no podrá invocar las nuevas tools.

```bash
# Después de cualquier cambio en tools o descripciones:
jarvis mcp sync
# Luego reiniciar la sesión de Claude Code
```
