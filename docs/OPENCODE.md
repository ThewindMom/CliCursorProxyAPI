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
        "cursor-acp/auto": { "name": "Auto" },
        "cursor-acp/composer-1.5": { "name": "Composer 1.5" },
        "cursor-acp/composer-1": { "name": "Composer 1" },
        "cursor-acp/opus-4.6-thinking": { "name": "Claude 4.6 Opus (Thinking)" },
        "cursor-acp/opus-4.6": { "name": "Claude 4.6 Opus" },
        "cursor-acp/sonnet-4.6": { "name": "Claude 4.6 Sonnet" },
        "cursor-acp/sonnet-4.6-thinking": { "name": "Claude 4.6 Sonnet (Thinking)" },
        "cursor-acp/opus-4.5": { "name": "Claude 4.5 Opus" },
        "cursor-acp/opus-4.5-thinking": { "name": "Claude 4.5 Opus (Thinking)" },
        "cursor-acp/sonnet-4.5": { "name": "Claude 4.5 Sonnet" },
        "cursor-acp/sonnet-4.5-thinking": { "name": "Claude 4.5 Sonnet (Thinking)" },
        "cursor-acp/gpt-5.4-high": { "name": "GPT-5.4 High" },
        "cursor-acp/gpt-5.4-high-fast": { "name": "GPT-5.4 High Fast" },
        "cursor-acp/gpt-5.4-xhigh": { "name": "GPT-5.4 Extra High" },
        "cursor-acp/gpt-5.4-xhigh-fast": { "name": "GPT-5.4 Extra High Fast" },
        "cursor-acp/gpt-5.4-medium": { "name": "GPT-5.4" },
        "cursor-acp/gpt-5.4-medium-fast": { "name": "GPT-5.4 Fast" },
        "cursor-acp/gpt-5.3-codex": { "name": "GPT-5.3 Codex" },
        "cursor-acp/gpt-5.3-codex-fast": { "name": "GPT-5.3 Codex Fast" },
        "cursor-acp/gpt-5.3-codex-low": { "name": "GPT-5.3 Codex Low" },
        "cursor-acp/gpt-5.3-codex-low-fast": { "name": "GPT-5.3 Codex Low Fast" },
        "cursor-acp/gpt-5.3-codex-high": { "name": "GPT-5.3 Codex High" },
        "cursor-acp/gpt-5.3-codex-high-fast": { "name": "GPT-5.3 Codex High Fast" },
        "cursor-acp/gpt-5.3-codex-xhigh": { "name": "GPT-5.3 Codex Extra High" },
        "cursor-acp/gpt-5.3-codex-xhigh-fast": { "name": "GPT-5.3 Codex Extra High Fast" },
        "cursor-acp/gpt-5.3-codex-spark-preview": { "name": "GPT-5.3 Codex Spark" },
        "cursor-acp/gpt-5.2": { "name": "GPT-5.2" },
        "cursor-acp/gpt-5.2-high": { "name": "GPT-5.2 High" },
        "cursor-acp/gpt-5.2-codex": { "name": "GPT-5.2 Codex" },
        "cursor-acp/gpt-5.2-codex-fast": { "name": "GPT-5.2 Codex Fast" },
        "cursor-acp/gpt-5.2-codex-low": { "name": "GPT-5.2 Codex Low" },
        "cursor-acp/gpt-5.2-codex-low-fast": { "name": "GPT-5.2 Codex Low Fast" },
        "cursor-acp/gpt-5.2-codex-high": { "name": "GPT-5.2 Codex High" },
        "cursor-acp/gpt-5.2-codex-high-fast": { "name": "GPT-5.2 Codex High Fast" },
        "cursor-acp/gpt-5.2-codex-xhigh": { "name": "GPT-5.2 Codex Extra High" },
        "cursor-acp/gpt-5.2-codex-xhigh-fast": { "name": "GPT-5.2 Codex Extra High Fast" },
        "cursor-acp/gpt-5.1-codex-max": { "name": "GPT-5.1 Codex Max" },
        "cursor-acp/gpt-5.1-codex-max-high": { "name": "GPT-5.1 Codex Max High" },
        "cursor-acp/gpt-5.1-codex-mini": { "name": "GPT-5.1 Codex Mini" },
        "cursor-acp/gpt-5.1-high": { "name": "GPT-5.1 High" },
        "cursor-acp/gemini-3.1-pro": { "name": "Gemini 3.1 Pro" },
        "cursor-acp/gemini-3-pro": { "name": "Gemini 3 Pro" },
        "cursor-acp/gemini-3-flash": { "name": "Gemini 3 Flash" },
        "cursor-acp/grok": { "name": "Grok" },
        "cursor-acp/kimi-k2.5": { "name": "Kimi K2.5" }
      }
    }
  }
}
```

### Step 4: Verify Model List

Refresh the model list in OpenCode:

```bash
/models
```

You should see the Cursor ACP models listed under the provider.

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

```bash
curl -X POST http://localhost:32124/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cursor-acp/auto",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

This should return a streaming SSE response.

## Troubleshooting

### Proxy Not Running

If the proxy is not running, start it:

```bash
bun run proxy
```

### Authentication Issues

If you see auth errors:

1. Verify cursor-agent is installed: `cursor-agent --version`
2. Login: `cursor-agent login`
3. Check health: `curl http://localhost:32124/health` - should show `auth: "authenticated"`

### Model Not Found

If you get model not found errors:

1. Verify the model name matches exactly (e.g., `cursor-acp/auto`)
2. Check the model is available: `curl http://localhost:32124/v1/models`

### Connection Refused

If you get connection refused:

1. Verify proxy is running on port 32124
2. Check no other process is using the port: `lsof -i :32124`

## Model Selection in OpenCode

After configuration, you can select models in OpenCode:

1. Run `/models` command
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
