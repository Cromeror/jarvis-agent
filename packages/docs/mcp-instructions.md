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
