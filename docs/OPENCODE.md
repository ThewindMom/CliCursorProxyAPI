# OpenCode Integration Guide

This document describes how to configure OpenCode to use CliCursorProxyAPI as a provider, enabling access to Cursor Pro subscription models through the proxy.

## Overview

CliCursorProxyAPI provides an OpenAI-compatible REST API that can be used by OpenCode via the `@ai-sdk/openai-compatible` provider package. This allows OpenCode to access Cursor Pro models without requiring direct Cursor API integration.

## Prerequisites

1. **OpenCode installed**: Download from [opencode.ai](https://opencode.ai)
2. **CliCursorProxyAPI running**: Start the proxy with `bun run proxy`
3. **cursor-agent installed**: Required for authentication
4. **Cursor Pro subscription**: Required for API access

## Configuration

### Step 1: Start the Proxy

```bash
cd /path/to/opencode-cursor
bun run proxy
```

The proxy runs on port 32124 by default. Verify it's running:

```bash
curl http://localhost:32124/health
```

Expected response:
```json
{"status":"ok","version":"2.3.20","auth":"not_authenticated","mcp":{"enabled":false,"servers":0,"tools":0}}
```

### Step 2: Authenticate with cursor-agent

For the proxy to work with Cursor Pro models, you need to authenticate:

```bash
cursor-agent login
```

This opens a browser for OAuth authentication with Cursor.

### Step 3: Configure OpenCode

Add the following to your OpenCode config file (`~/.config/opencode/opencode.json` or project-level `opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "cursor-acp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cursor ACP",
      "options": {
        "baseURL": "http://127.0.0.1:32124/v1"
      },
      "models": {
        "cursor-acp/composer-2": { "name": "Composer 2" },
        "cursor-acp/composer-2-fast": { "name": "Composer 2 Fast" },
        "cursor-acp/composer-1.5": { "name": "Composer 1.5" },
        "cursor-acp/auto": { "name": "Auto" },
        "cursor-acp/sonnet-4.6": { "name": "Sonnet 4.6" },
        "cursor-acp/opus-4.6": { "name": "Opus 4.6" }
      }
    }
  }
}
```

### Step 4: Verify Model List

```bash
opencode models cursor-acp
```

You should see models listed with the double prefix:
```
cursor-acp/cursor-acp/auto
cursor-acp/cursor-acp/composer-1.5
cursor-acp/cursor-acp/composer-2
cursor-acp/cursor-acp/composer-2-fast
cursor-acp/cursor-acp/opus-4.6
cursor-acp/cursor-acp/sonnet-4.6
```

**Note:** The double `cursor-acp/cursor-acp/` prefix is cosmetic. When OpenCode makes API requests, it strips the provider prefix and sends just `auto`, `sonnet-4.6`, etc. to the proxy.

## Testing the Integration

### Verify Proxy is Running

```bash
curl http://localhost:32124/health
```

### List Available Models

```bash
curl http://localhost:32124/v1/models
```

After authentication, this should return a list of available Cursor Pro models.

### Test Chat Completions

**Via curl (proxy directly):**
```bash
curl -X POST http://localhost:32124/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

**Via OpenCode CLI:**
```bash
opencode run --model "cursor-acp/cursor-acp/auto" "Say hello in 3 words"
```

This should return a streaming SSE response.

## Troubleshooting

### "Unknown model" Error in OpenCode

If you see `Error: Unknown model: cursor-acp/auto`:

1. **Use the full model name with double prefix:**
   ```bash
   opencode run --model "cursor-acp/cursor-acp/auto" "Your prompt"
   ```

2. **Verify proxy is running:**
   ```bash
   curl http://localhost:32124/health
   ```

3. **Restart OpenCode** after config changes

### Proxy Not Running

If the proxy is not running, start it:

```bash
cd /path/to/CliCursorProxyAPI
bun run proxy
```

### Authentication Issues

If you see auth errors:

1. Verify cursor-agent is installed: `cursor-agent --version`
2. Login: `cursor-agent login`
3. Check health: `curl http://localhost:32124/health` - should show `auth: "authenticated"`

### Model Not Found (curl)

If you get model not found errors via curl:

1. Use the bare model name (no `cursor-acp/` prefix):
   ```bash
   curl -X POST http://localhost:32124/v1/chat/completions \
     -d '{"model": "auto", ...}'  # NOT "cursor-acp/auto"
   ```
2. Check the model is available: `curl http://localhost:32124/v1/models`

### Connection Refused

If you get connection refused:

1. Verify proxy is running on port 32124: `lsof -i :32124`
2. Start the proxy: `bun run proxy`

### Config File JSON Syntax Error

If OpenCode fails to load the config:

1. Validate JSON:
   ```bash
   python3 -m json.tool ~/.config/opencode/opencode.json > /dev/null
   ```
2. Fix any trailing commas (JSON doesn't allow them)

## Using CliCursorProxyAPI Models in OpenCode

### OpenCode CLI

Run a single prompt with a specific model:
```bash
opencode run --model "cursor-acp/cursor-acp/composer-2-fast" "Your prompt here"
```

### OpenCode TUI

Start the TUI with a specific model:
```bash
opencode -m cursor-acp/cursor-acp/sonnet-4.6
```

Or within the TUI:
1. Press `m` to open model selector
2. Select "Cursor ACP" provider
3. Choose your desired model

## Supported Models

The proxy supports all Cursor Pro models including:

- **Claude models**: Opus 4.5/4.6, Sonnet 4.5/4.6 (with and without thinking)
- **GPT models**: 5.1, 5.2, 5.3, 5.4 variants
- **Other**: Gemini 3.1/3 Pro, Grok, Kimi K2.5

## Advanced Configuration

### Custom Port

To run the proxy on a different port, set the `PORT` environment variable:

```bash
PORT=32125 bun run proxy
```

Then update your opencode.json baseURL accordingly.

### Remote Server

To connect to a proxy running on a remote server:

```json
{
  "provider": {
    "cursor-acp": {
      "options": {
        "baseURL": "http://your-server:32124/v1"
      }
    }
  }
}
```

### Multiple Providers

You can configure multiple providers in opencode.json:

```json
{
  "provider": {
    "cursor-acp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cursor ACP",
      "options": {
        "baseURL": "http://127.0.0.1:32124/v1"
      },
      "models": { ... }
    },
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": {
        "baseURL": "http://localhost:11434/v1"
      },
      "models": { ... }
    }
  }
}
```

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   OpenCode  │────▶│  CliCursorProxy  │────▶│  cursor-agent   │
│             │     │    (port 32124)  │     │   (CLI auth)   │
└─────────────┘     └──────────────────┘     └─────────────────┘
                            │
                            ▼
                    ┌─────────────────┐
                    │  Cursor API     │
                    │ (api2.cursor.sh)│
                    └─────────────────┘
```

The proxy:
1. Accepts OpenAI-compatible requests from OpenCode
2. Forwards them to cursor-agent CLI
3. Converts cursor-agent's NDJSON output to SSE
4. Returns streaming responses to OpenCode

## Security Considerations

- The proxy binds to `127.0.0.1` by default (localhost only)
- Authentication is handled by cursor-agent CLI
- No API keys are stored by the proxy
- Use firewall rules for remote access
