# Formato de descripciones Jira — referencia autoritativa

Esta guía es la ÚNICA fuente de verdad para formatear descripciones de tickets Jira vía `jira_update_ticket`. Cuando el user pregunte cómo formatear, respondé SOLAMENTE con lo que está acá. No inventes sintaxis, no uses HTML, no uses `taskList`, no uses `decisionList`, no uses imágenes.

## Reglas duras

1. El input SIEMPRE es Markdown. Jarvis convierte a ADF (Atlassian Document Format) internamente. Nunca mandes ADF JSON.
2. Target: Jira Cloud (no Confluence). Nodos Confluence-only (`taskList`, `decisionList`, `layoutSection`, `blockCard`) se rompen — no emitir.
3. Matriz de incompatibilidad de marks — Jarvis la respeta automáticamente, pero evitá intentar estas combinaciones:
   - `code` + `textColor` | `backgroundColor` | `link` → prohibido.
   - `link` + `code` → prohibido.
4. Tablas no se anidan. Si necesitás contenido estructurado dentro de una celda, usá `:::expand` (o texto enriquecido simple).
5. Panels (`:::info`, `:::warning`, etc.) pueden contener bloques pero el heading/paragraph interno NO lleva marks — Jarvis los strip automáticamente.
6. Jira Cloud ignora `layout` / `width` de tablas: siempre se ven full-width.
7. Tablas no renderizan en mobile — evitá si el equipo las revisa en móvil.

## Catálogo — bloques (TOON)

```
blockNodes[12]{name,markdownSyntax,notas}:
  paragraph,"texto normal",—
  heading,"# a ######, hasta 6 niveles",—
  bulletList,"- item o * item",—
  orderedList,"1. item",orden numérico
  blockquote,"> texto",—
  codeBlock,"```lang\nbloque\n```","language opcional (ts, bash, json, sql, python, etc.)"
  rule,"---",línea horizontal
  panel,":::info | :::warning | :::error | :::success | :::note\n...\n:::",5 tipos exactos
  expand,":::expand Título\n...\n:::",colapsable en Jira Cloud
  table,"GFM estándar: | h | h |\n|---|---|\n| c | c |","celdas coloreadas con {bg:#hex}"
  hardBreak,"\\ al final de línea o dos espacios EOL",salto de línea dentro del párrafo
  tableCellBackground,"{bg:#hex} al inicio del contenido de celda",—
```

## Catálogo — marks inline (TOON)

```
marks[10]{name,syntax,incompatibleCon,ejemplo}:
  strong,**texto** o __texto__,—,**importante**
  em,*texto* o _texto_,—,*énfasis*
  underline,++texto++,—,++subrayado++
  strike,~~texto~~,—,~~removido~~
  code,`texto`,"textColor,backgroundColor,link",`foo()`
  link,[texto](url),code,[docs](https://…)
  textColor,{color:#hex}texto{/color},"code,link",{color:#FF5630}rojo{/color}
  backgroundColor,{bg:#hex}texto{/bg},code,{bg:#FFFF00}highlight{/bg}
  subscript,~texto~ (sin espacios adentro),—,H~2~O
  superscript,^texto^ (sin espacios adentro),—,x^2^
```

## Catálogo — nodos inline (TOON)

```
inlineNodes[3]{name,syntax,ejemplo}:
  status,"{status:color|texto}","{status:green|Ready}"
  emoji,":shortname:",":warning:"
  hardBreak,"\\ al final de línea",—
```

## Status — colores permitidos (TOON)

```
statusColors[6]{color,usoSugerido}:
  neutral,default gris — estados sin categoría
  green,"Ready / Done / Approved / OK"
  yellow,"In Progress / Warning / Pending"
  red,"Blocked / Error / Rejected"
  blue,"Info / In Review / Waiting external"
  purple,"Custom workflow / Paused"
```

Color fuera de esa lista → Jarvis usa `neutral` como fallback.

## Tablas con colores — ejemplo completo

```markdown
| Color | Hex | Uso |
|-------|-----|-----|
| {bg:#36B37E}Verde{/bg} | #36B37E | Éxito |
| {bg:#FF5630}Rojo{/bg} | #FF5630 | Error |
| {bg:#0052CC}Azul{/bg} | #0052CC | Info |
```

La sintaxis `{bg:#hex}` al inicio del contenido de la celda pinta el fondo de la celda con ese hex. El texto adentro sigue siendo Markdown normal (podés anidar **bold**, *em*, links).

## Esqueleto estándar para tickets refinados

```markdown
## 🎯 Contexto
Párrafo de 2-4 oraciones explicando el problema y por qué importa.

## ✅ Criterios de aceptación
- [ ] Criterio 1 concreto y verificable
- [ ] Criterio 2
- [ ] Criterio 3

## 📋 Tareas técnicas
1. Paso uno
2. Paso dos

## 📊 Datos / referencias
| Campo | Valor | Status |
|-------|-------|--------|
| API endpoint | `/v2/payments` | {status:green|Ready} |
| Feature flag | `payments_v2` | {status:yellow|En dev} |
| DB migration | 2025-04-30 | {status:blue|Pending} |

## ⚠️ Consideraciones
:::warning
Casos borde y riesgos relevantes para el refinamiento.
:::

:::info
Contexto adicional, links útiles, decisiones previas.
:::

:::expand Detalles técnicos
Contenido extenso que queda colapsado por default (diagramas ASCII,
queries SQL, pseudocódigo, matrices grandes).
:::

## 🔗 Referencias
- [Spec original](https://…)
- Ticket relacionado: PROJ-123
- Slack: #canal-relevante
```

## Emojis sugeridos por sección

```
emojis[9]{seccion,emoji,uso}:
  contexto,🎯,goal / objetivo
  criteriosAceptacion,✅,AC
  tareasTecnicas,📋,tasks
  datos,📊,tablas de datos
  consideraciones,⚠️,riesgos
  info,ℹ️,contexto extra
  testing,🧪,QA
  deploy,🚀,release
  referencias,🔗,links
```

Regla: **un emoji por heading, no más**. Emojis Unicode directos son siempre válidos; el `:shortname:` (emoji node ADF) solo para los del set oficial de Atlassian.

## Qué NO hacer

- ❌ HTML crudo (`<b>`, `<br>`, `<div>`, `<span>`). No se convierte.
- ❌ Tablas anidadas (`table` dentro de `tableCell`). Usar `:::expand` si necesitás colapsable.
- ❌ `taskList` / `- [ ]` esperando checkbox interactivo. Jira no los renderiza como interactivos; se ven como bullet list normal.
- ❌ `decisionList`. Usar `:::info` titulado "Decisión".
- ❌ `layoutSection` / `layoutColumn`. Jira siempre es single-column.
- ❌ Imágenes inline (`![alt](url)`). Requiere upload previo al Media Service — no soportado por este converter.
- ❌ `blockCard`. No existe en Jira Cloud — usar `inlineCard` (o un link normal).
- ❌ ADF JSON manual. Siempre pasá Markdown.
- ❌ Wiki markup de Confluence antiguo (`h1.`, `{color}` estilo viejo).
- ❌ Colores fuera de la paleta Atlassian recomendada cuando hay opción — preferí hex de la paleta oficial (ver `atlassian.design/foundations/color-new`).

## Futuro (no soportado hoy)

Features de ADF que Jarvis **no** convierte todavía — si el user las pide, indicá que son manuales en Jira:

```
future[4]{node,razón}:
  mention,"requiere accountId vía Jira API"
  date,"manual timestamp ms, ambiguo en spec"
  inlineCard,"no hay sintaxis Markdown natural"
  media,"requiere upload previo al Media Service"
```

## Cuándo usar jira_update_ticket

1. User pide crear/actualizar la descripción de un ticket → armá Markdown siguiendo el esqueleto estándar.
2. User pide editar summary, assignee, o labels → usá los params correspondientes, mandá solo los campos que cambian.
3. Después de procesar, **confirmá los valores con el user antes de ejecutar** — es efecto externo en Jira, visible para todo el equipo.
4. Pasá el Markdown con \n reales (saltos de línea) en el param `description`. La tool convierte a ADF y usa `--description-file` vía archivo temp.
