# Workflows de la tool Jira

Esta carpeta guarda los workflows de n8n que la tool Jira necesita, versionados como JSON. Cuando corres la tool, JARVIS revisa si el workflow existe en tu n8n. Si no existe, lo crea automaticamente desde estos archivos. Asi cualquier persona que clone el repo obtiene los mismos workflows sin configuracion manual.

## Como exportar cambios desde la UI de n8n

1. Abre n8n en `http://localhost:5678` y edita el workflow que quieras mejorar.
2. Prueba que funciona correctamente.
3. Guarda los cambios en el JSON del repo:

   ```bash
   jarvis n8n export jira-analyze-ticket
   ```

4. Commitea el archivo actualizado:

   ```bash
   git add workflows/jira-analyze-ticket.json
   git commit -m "feat: mejora parsing del workflow"
   ```

## Agregar un workflow nuevo

1. Crealo en la UI de n8n.
2. Expórtalo con `jarvis n8n export <nombre>`.
3. Registra su nombre en la tool que lo usa.
