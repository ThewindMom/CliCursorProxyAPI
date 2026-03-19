# oh-my-pi Integration Guide

This document describes how to configure oh-my-pi to use CliCursorProxyAPI as a custom provider, enabling access to Cursor Pro subscription models through the proxy.

## Overview

oh-my-pi supports custom providers via its extension system. CliCursorProxyAPI provides an OpenAI-compatible REST API that can be registered as a custom provider in oh-my-pi, allowing access to Cursor Pro models without requiring direct Cursor API integration.

## Prerequisites

1. **oh-my-pi installed**: Follow [installation instructions](https://github.com/can1357/oh-my-pi)
2. **CliCursorProxyAPI running**: Start the proxy with `bun run proxy`
3. **cursor-agent installed**: Required for authentication
4. **Cursor Pro subscription**: Required for API access

## How It Works

oh-my-pi uses an extension-based provider system. You create an extension file that registers CliCursorProxyAPI as a provider with the `openai-completions` API type. The proxy handles authentication via cursor-agent internally.

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

### Step 3: Create the Extension File

Create a new extension file at `~/.omp/extensions/cursor-acp.ts` (or in your project's `.omp/extensions/` directory):

```typescript
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("cursor-acp", {
    baseUrl: "http://127.0.0.1:32124/v1",
    apiKey: "dummy",  // Required but ignored; auth is handled by cursor-agent
    api: "openai-completions",
    models: [
      { id: "auto", name: "Auto", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "composer-1.5", name: "Composer 1.5", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "composer-1", name: "Composer 1", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "opus-4.6-thinking", name: "Claude 4.6 Opus (Thinking)", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "opus-4.6", name: "Claude 4.6 Opus", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "sonnet-4.6", name: "Claude 4.6 Sonnet", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "sonnet-4.6-thinking", name: "Claude 4.6 Sonnet (Thinking)", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "opus-4.5", name: "Claude 4.5 Opus", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "opus-4.5-thinking", name: "Claude 4.5 Opus (Thinking)", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "sonnet-4.5", name: "Claude 4.5 Sonnet", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "sonnet-4.5-thinking", name: "Claude 4.5 Sonnet (Thinking)", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.4-high", name: "GPT-5.4 High", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.4-high-fast", name: "GPT-5.4 High Fast", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.4-xhigh", name: "GPT-5.4 Extra High", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.4-xhigh-fast", name: "GPT-5.4 Extra High Fast", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.4-medium", name: "GPT-5.4", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.4-medium-fast", name: "GPT-5.4 Fast", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.3-codex-fast", name: "GPT-5.3 Codex Fast", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.3-codex-low", name: "GPT-5.3 Codex Low", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.3-codex-low-fast", name: "GPT-5.3 Codex Low Fast", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.3-codex-high", name: "GPT-5.3 Codex High", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.3-codex-high-fast", name: "GPT-5.3 Codex High Fast", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.3-codex-xhigh", name: "GPT-5.3 Codex Extra High", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.3-codex-xhigh-fast", name: "GPT-5.3 Codex Extra High Fast", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.3-codex-spark-preview", name: "GPT-5.3 Codex Spark", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.2", name: "GPT-5.2", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.2-high", name: "GPT-5.2 High", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.2-codex-fast", name: "GPT-5.2 Codex Fast", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.2-codex-low", name: "GPT-5.2 Codex Low", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.2-codex-low-fast", name: "GPT-5.2 Codex Low Fast", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.2-codex-high", name: "GPT-5.2 Codex High", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.2-codex-high-fast", name: "GPT-5.2 Codex High Fast", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.2-codex-xhigh", name: "GPT-5.2 Codex Extra High", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.2-codex-xhigh-fast", name: "GPT-5.2 Codex Extra High Fast", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.1-codex-max-high", name: "GPT-5.1 Codex Max High", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.1-high", name: "GPT-5.1 High", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gemini-3-pro", name: "Gemini 3 Pro", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "gemini-3-flash", name: "Gemini 3 Flash", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "grok", name: "Grok", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
      { id: "kimi-k2.5", name: "Kimi K2.5", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 },
    ]
  });
}
```

### Step 4: Reload oh-my-pi

If oh-my-pi was already running, reload the extensions:

```
/reload
```

Or restart oh-my-pi to load the new extension.

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
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

This should return a streaming SSE response.

## Using Models in oh-my-pi

After configuration, you can select models in oh-my-pi:

1. Run `/models` command to see available models
2. Select "cursor-acp" provider
3. Choose your desired model

Or use the model directly in a prompt:

```
/prompt --model cursor-acp:opus-4.6 "Your prompt here"
```

## Supported Models

The proxy supports all Cursor Pro models including:

- **Claude models**: Opus 4.5/4.6, Sonnet 4.5/4.6 (with and without thinking)
- **GPT models**: 5.1, 5.2, 5.3, 5.4 variants
- **Other**: Gemini 3.1/3 Pro, Gemini 3 Flash, Grok, Kimi K2.5
- **Special**: Auto (automatic model selection), Composer 1/1.5

## Troubleshooting

### Proxy Not Running

If the proxy is not running, start it:

```bash
cd /path/to/opencode-cursor
bun run proxy
```

### Authentication Issues

If you see auth errors:

1. Verify cursor-agent is installed: `cursor-agent --version`
2. Login: `cursor-agent login`
3. Check health: `curl http://localhost:32124/health` - should show `auth: "authenticated"`

### Extension Not Loading

1. Verify the extension file exists at `~/.omp/extensions/cursor-acp.ts`
2. Check oh-my-pi is looking in the correct extensions directory
3. Reload with `/reload` command
4. Check for any TypeScript errors in the extension file

### Connection Refused

If you get connection refused:

1. Verify proxy is running on port 32124
2. Check no other process is using the port: `lsof -i :32124`
3. Ensure the baseUrl in the extension matches the proxy port

## Advanced Configuration

### Custom Port

To run the proxy on a different port, set the `PORT` environment variable:

```bash
PORT=32125 bun run proxy
```

Then update your extension's baseUrl accordingly:

```typescript
baseUrl: "http://127.0.0.1:32125/v1"
```

### Remote Server

To connect to a proxy running on a remote server:

```typescript
pi.registerProvider("cursor-acp", {
  baseUrl: "http://your-server:32124/v1",
  // ... rest of config
});
```

### Combining with Other Providers

You can register multiple providers in the same extension:

```typescript
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Cursor ACP provider
  pi.registerProvider("cursor-acp", {
    baseUrl: "http://127.0.0.1:32124/v1",
    apiKey: "dummy",
    api: "openai-completions",
    models: [/* ... */]
  });

  // Ollama provider
  pi.registerProvider("ollama", {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "dummy",
    api: "openai-completions",
    models: [
      { id: "llama2", name: "Llama 2", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 2048 }
    ]
  });
}
```

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  oh-my-pi   │────▶│  CliCursorProxy  │────▶│  cursor-agent   │
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
1. Accepts OpenAI-compatible requests from oh-my-pi
2. Forwards them to cursor-agent CLI
3. Converts cursor-agent's NDJSON output to SSE
4. Returns streaming responses to oh-my-pi

## Security Considerations

- The proxy binds to `127.0.0.1` by default (localhost only)
- Authentication is handled by cursor-agent CLI
- No API keys are stored by the proxy
- Use firewall rules for remote access
