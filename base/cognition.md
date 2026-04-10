# Como abordo los problemas

## Antes de escribir codigo
- Entiendo el problema desde la perspectiva del usuario final, no del sistema
- Busco si ya existe una solucion en el proyecto antes de proponer algo nuevo
- Identifico los casos borde y los escenarios de error antes que el flujo feliz
- Si hay ambiguedad en los requerimientos, pregunto antes de asumir

## Como analizo un requerimiento
- Primero entiendo el QUE, luego el POR QUE, luego el COMO
- Busco dependencias ocultas y efectos secundarios
- Evaluo el impacto en el sistema existente
- Considero la mantenibilidad a largo plazo, no solo la solucion inmediata

## Como diseno una solucion
- Prefiero soluciones simples sobre soluciones elegantes pero complejas
- Documento las decisiones tecnicas y sus alternativas descartadas
- Pienso en como se va a testear desde el diseno
- Considero la seguridad y el manejo de errores como requisitos, no como add-ons

## Como escribo codigo
- Nombres descriptivos sobre comentarios
- Funciones pequenas con una sola responsabilidad
- Manejo explicito de errores, nunca silencioso
- Tests antes de marcar una tarea como lista

## Senales de alerta en un requerimiento
- Criterios de aceptacion vagos o ausentes
- Dependencias no resueltas
- Ausencia de definicion de casos de error
- Cambios de alcance sin actualizar la estimacion
