# Configuración de IA en JARVIS

JARVIS requiere un proveedor de IA para funcionar. Esta guía explica cómo configurarlo.

---

## Descripción general

JARVIS soporta tres proveedores de IA. Solo uno puede estar activo a la vez, y la configuración se almacena en la base de datos local.

| Proveedor | Tipo | API Key |
|-----------|------|---------|
| **Anthropic** (Claude) | Nube | Sí — console.anthropic.com |
| **Ollama** | Local | No — corre en tu máquina |
| **Qwen** (DashScope) | Nube | Sí — Alibaba Cloud |

---

## Configuración rápida (CLI)

```bash
# Interactivo (recomendado)
jarvis ai setup

# No interactivo:

# Anthropic
jarvis ai set anthropic --model claude-sonnet-4-20250514 --api-key sk-ant-xxx

# Ollama (gratis, local)
jarvis ai set ollama --model llama3.1:8b --base-url http://localhost:11434

# Qwen
jarvis ai set qwen --model qwen-plus --api-key sk-xxx --base-url https://dashscope.aliyuncs.com/compatible-mode
```

---

## Configuración rápida (HTTP API)

```bash
POST /api/ai/config
{ "provider": "ollama", "model": "llama3.1:8b", "base_url": "http://localhost:11434" }
```

---

## Detalle por proveedor

### Anthropic

- **Sitio web**: console.anthropic.com
- **Precio**: Pago por uso (~$3/M tokens de entrada para Sonnet)
- **Modelos recomendados**: `claude-sonnet-4-20250514` (uso general), `claude-haiku-4-5-20251001` (rápido y económico)
- **Requiere**: API key
- **Capacidades**: Chat + Tool Use (function calling)

**Pasos de configuración:**

1. Crear cuenta en [console.anthropic.com](https://console.anthropic.com)
2. Agregar crédito ($5 mínimo)
3. Crear API key en **Settings > API Keys**
4. Ejecutar:
   ```bash
   jarvis ai set anthropic --model claude-sonnet-4-20250514 --api-key <tu-key>
   ```

---

### Ollama

- **Sitio web**: ollama.com
- **Precio**: Gratis (corre en tu máquina)
- **Modelos recomendados**: `llama3.1:8b` (ligero), `llama3.1:70b` (potente), `mistral:7b` (rápido)
- **Requiere**: Ollama instalado y corriendo
- **Capacidades**: Chat (sin tool use nativo)

**Pasos de configuración:**

1. Instalar Ollama:
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ```
2. Descargar un modelo:
   ```bash
   ollama pull llama3.1:8b
   ```
3. Verificar que Ollama está corriendo:
   ```bash
   curl http://localhost:11434/api/version
   ```
4. Configurar en JARVIS:
   ```bash
   jarvis ai set ollama --model llama3.1:8b
   ```

---

### Qwen (DashScope)

- **Sitio web**: dashscope.aliyun.com
- **Precio**: Free tier disponible
- **Modelos recomendados**: `qwen-plus` (balanceado), `qwen-turbo` (rápido), `qwen-max` (potente)
- **Requiere**: API key de Alibaba Cloud
- **Capacidades**: Chat (formato compatible con OpenAI)

**Pasos de configuración:**

1. Crear cuenta en Alibaba Cloud
2. Activar DashScope
3. Generar una API key
4. Configurar en JARVIS:
   ```bash
   jarvis ai set qwen --model qwen-plus --api-key <tu-key>
   ```

---

## Referencia de comandos CLI

| Comando | Descripción |
|---------|-------------|
| `jarvis ai setup` | Configuración interactiva |
| `jarvis ai status` | Ver proveedor activo |
| `jarvis ai list` | Listar todos los proveedores configurados |
| `jarvis ai activate <provider>` | Cambiar proveedor activo |
| `jarvis ai set <provider> [options]` | Configuración no-interactiva |
| `jarvis ai test` | Probar conexión con el proveedor activo |

**Opciones para `jarvis ai set`:**

| Opción | Descripción |
|--------|-------------|
| `--model <model>` | Nombre del modelo |
| `--api-key <key>` | API key (Anthropic, Qwen) |
| `--base-url <url>` | URL base (Ollama, Qwen) |
| `--no-activate` | No activar después de configurar |

---

## Endpoints HTTP

```
GET  /api/ai/status     → proveedor activo
GET  /api/ai/list       → todos los proveedores configurados
POST /api/ai/config     → configurar un proveedor
POST /api/ai/activate   → activar un proveedor
POST /api/ai/test       → probar la conexión
```

---

## Solución de problemas

| Error | Causa | Solución |
|-------|-------|----------|
| `AI provider is not configured` | No hay proveedor configurado | Ejecutar `jarvis ai setup` |
| `Anthropic API error (401)` | API key inválida o expirada | Regenerar la key en console.anthropic.com |
| `Ollama API error (connection refused)` | Ollama no está corriendo | Ejecutar `ollama serve` |
| `Qwen API error (403)` | API key inválida o sin créditos | Verificar la key y los créditos en DashScope |

---

## Para usuarios de MCP (Claude Code, Cursor)

Si JARVIS está conectado vía MCP, la IA debe estar configurada antes de usar herramientas que requieren inteligencia (validación de reglas, análisis, etc.). El servidor MCP retornará las instrucciones de configuración cuando la IA no esté disponible.

Configurar el proveedor antes de iniciar el servidor MCP:

```bash
jarvis ai setup
```
