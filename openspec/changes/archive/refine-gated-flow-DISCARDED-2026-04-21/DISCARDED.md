# refine-gated-flow — DESCARTADO

**Fecha de descarte:** 2026-04-21
**Estado:** No implementado, descartado intencionalmente.

## Razón

El scope de este cambio (gating en 2 fases con preguntas `[Ax]/[Mx]` y columna `phase` en refinements) fue reemplazado conceptualmente por el cambio `refine-flow-refactor`, que toma una dirección distinta: refactor simple del flujo actual sin introducir fases ni parser de preguntas, más renombrado de estados (`draft/final` → `in_progress/completed`) y cambio de semántica del hilo cerrado (ya no tira error, reabre automáticamente).

## Sin impacto

- No se ejecutó ninguna tarea.
- No hay código derivado de este cambio en el repo.
- No hay migraciones aplicadas.
- Cualquier decisión útil del design se preserva en la historia git de `openspec/changes/archive/refine-gated-flow-DISCARDED-2026-04-21/`.
