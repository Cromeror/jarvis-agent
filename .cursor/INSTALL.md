# Instalar las reglas de Jarvis en Cursor

Este documento contiene el prompt para indicarle a Cursor cómo adoptar este set de reglas en otro proyecto, separando **qué conviene global** (User Rules, aplica siempre) y **qué conviene local** (reglas del proyecto, aplica solo acá).

## Criterio de separación

| Tipo | Qué va | Por qué |
|------|--------|---------|
| **Global** (User Rules) | Reglas genéricas sobre Jarvis que no imponen convenciones de un proyecto ajeno | Te sirven en cualquier repo donde quieras usar Jarvis, sin contaminar proyectos que no lo tocan |
| **Local** (`.cursor/rules/` del repo) | Reglas sobre flujos específicos (refinar tickets de este proyecto, generar código con el stack de este proyecto) | Solo tienen sentido donde ese flujo aplica; globalizarlas sería ruido |

### Reglas que van en global (3)

- `jarvis-project-init` — bootstrap de Jarvis en cualquier repo. Útil siempre.
- `jarvis-doctor-and-troubleshooting` — runbook de diagnóstico. Útil siempre.
- `jarvis-rules-and-stack` — cómo Jarvis resuelve contexto del proyecto. Útil siempre.

### Reglas que van en local (6)

- `jarvis-refinement` — solo relevante en proyectos donde se refinan tareas vía Jarvis.
- `jarvis-jira-refinement` — solo relevante en proyectos con Jira conectado.
- `jarvis-jira-setup` — solo cuando vas a conectar Jira a ese proyecto.
- `jarvis-n8n-setup` — solo cuando vas a conectar n8n a ese proyecto.
- `jarvis-n8n-workflows` — solo cuando ese proyecto usa workflows de n8n.
- `jarvis-code-tools` — solo cuando querés que Jarvis genere/revise código para ese proyecto.

---

## Prompt para Cursor

Copiá y pegá este bloque en el chat de Cursor del proyecto destino. Ajustá el path `~/work/Jarvis-agent/` si el repo está en otro lado.

```
Quiero que adoptes un set de reglas agentic de Cursor que viven en el repo de Jarvis-agent (asumilo en `~/work/Jarvis-agent/.cursor/rules/`). Instalalas separadas en dos grupos — globales (User Rules) para las genéricas, y locales (este repo) para las específicas.

### Grupo 1 — instalar como USER RULES (globales, Settings → Rules → User Rules)

Estas son genéricas y sirven en cualquier proyecto, no contaminan repos que no usan Jarvis. Leé el contenido de cada archivo y pegá el CUERPO (sin el frontmatter YAML `---`, porque User Rules no lo usan) como una regla global separada, conservando el nombre del archivo como título:

- ~/work/Jarvis-agent/.cursor/rules/tier-0-core/jarvis-project-init.mdc
- ~/work/Jarvis-agent/.cursor/rules/tier-2-transversal/jarvis-rules-and-stack.mdc
- ~/work/Jarvis-agent/.cursor/rules/tier-2-transversal/jarvis-doctor-and-troubleshooting.mdc

### Grupo 2 — instalar como REGLAS LOCALES del proyecto

Estas aplican solo donde el flujo tiene sentido. Copialas TAL CUAL (incluyendo el frontmatter YAML `---`, porque Cursor las necesita para decidir cuándo activarlas).

1. Asegurate de que exista `.cursor/rules/` en la raíz de este proyecto. Si no, creálo.

2. Dentro creá estas dos subcarpetas (omití `tier-2-transversal` — esas fueron al grupo global):
   - `tier-0-core/`
   - `tier-1-expansion/`

3. Copiá estos archivos respetando la estructura:

   ~/work/Jarvis-agent/.cursor/rules/tier-0-core/jarvis-refinement.mdc           → .cursor/rules/tier-0-core/
   ~/work/Jarvis-agent/.cursor/rules/tier-0-core/jarvis-jira-refinement.mdc      → .cursor/rules/tier-0-core/
   ~/work/Jarvis-agent/.cursor/rules/tier-0-core/jarvis-jira-setup.mdc           → .cursor/rules/tier-0-core/
   ~/work/Jarvis-agent/.cursor/rules/tier-1-expansion/jarvis-code-tools.mdc      → .cursor/rules/tier-1-expansion/
   ~/work/Jarvis-agent/.cursor/rules/tier-1-expansion/jarvis-n8n-setup.mdc       → .cursor/rules/tier-1-expansion/
   ~/work/Jarvis-agent/.cursor/rules/tier-1-expansion/jarvis-n8n-workflows.mdc   → .cursor/rules/tier-1-expansion/

4. Si este proyecto NO usa n8n, podés saltear los tres archivos `jarvis-n8n-*` — no son útiles acá.
   Si este proyecto NO usa Jira, podés saltear `jarvis-jira-*`.
   Si este proyecto NO va a usar las tools `code_*` de Jarvis, podés saltear `jarvis-code-tools`.

5. Al terminar, listá el contenido final con `ls -R .cursor/rules/` para que yo verifique.

6. No commitees los cambios al repo salvo que yo te lo pida explícitamente.

### Guía rápida para las User Rules (grupo 1)

Si no sabés cómo llegar a User Rules en Cursor:
1. Abrí Cursor.
2. Settings (⚙️) → Rules → User Rules.
3. Añadí una entrada por cada archivo del grupo 1, pegando el cuerpo Markdown (sin `---` del frontmatter).
4. Guardá.
```

---

## Notas de mantenimiento

- Si agregás una nueva regla al repo, decidí primero si aplica a todos los proyectos (global) o solo a algunos (local) y actualizá este archivo.
- Las reglas locales son más fáciles de compartir con un equipo (commit + PR); las globales son por máquina — cada persona del equipo las tiene que instalar una vez.
- Si una regla global empieza a generar ruido en proyectos que no usan Jarvis, movela a local.
