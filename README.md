# CliCursorProxyAPI

**Universal Cursor Proxy Gateway** — Enable any OpenAI-compatible client to use Cursor Pro subscription models.

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![Port: 32124](https://img.shields.io/badge/Port-32124-32124)](#)

## Overview

CliCursorProxyAPI is a standalone proxy server that provides OpenAI-compatible REST API access to Cursor Pro subscription models. It wraps `cursor-agent` CLI to handle authentication and API communication, exposing a universal OpenAI-compatible interface.

**Key Features:**
- 🚀 **Standalone proxy** — No OpenCode plugin required
- 🔌 **Universal client support** — Works with any OpenAI-compatible client
- 📡 **Streaming SSE** — Real-time streaming responses
- 🧠 **Full thinking support** — Includes reasoning/thinking content
- 🔧 **Tool calling** — Execute tools and MCP servers
- 🛡️ **Secure by default** — Binds to localhost, cursor-agent handles auth

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CliCursorProxyAPI                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  /health    │  │  /v1/models  │  │  /v1/chat/completions  │  │
│  │  GET        │  │  GET         │  │  POST (streaming SSE)  │  │
│  └──────────────┘  └──────────────┘  └────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      cursor-agent CLI                                │
│              (handles auth, API communication)                     │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Cursor API                                   │
│                  (api2.cursor.sh, agent.api5.cursor.sh)             │
└─────────────────────────────────────────────────────────────────────┘
```

**Request Flow:**
1. Client sends OpenAI-compatible request to proxy
2. Proxy spawns `cursor-agent` with appropriate arguments
3. `cursor-agent` communicates with Cursor API (handles auth internally)
4. Proxy converts `cursor-agent`'s NDJSON output to SSE format
5. Streaming response sent back to client

## Prerequisites

- **Runtime:** Bun 1.0+ or Node.js 18+
- **cursor-agent:** Install via `curl https://cursor.com/install -fsS | bash`
- **Cursor Pro subscription:** Required for API access
- **Authentication:** `cursor-agent login` must be completed

## Quickstart

### 1. Install & Build

```bash
git clone https://github.com/ThewindMom/CliCursorProxyAPI.git
cd CliCursorProxyAPI
bun install
bun run build
```

### 2. Start the Proxy

```bash
bun run proxy
```

The proxy starts on `http://127.0.0.1:32124` by default.

### 3. Authenticate

```bash
cursor-agent login
```

This opens a browser for OAuth authentication with Cursor.

### 4. Verify Setup

```bash
# Check health
curl http://localhost:32124/health
# {"status":"ok","version":"2.3.20","auth":"authenticated"}

# List models
curl http://localhost:32124/v1/models

# Test chat
curl -X POST http://localhost:32124/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}],"stream":true}'
```

## Using Composer 2

Composer 2 is Cursor's flagship model with frontier-level coding performance.

### Usage & Limits

**Important:** Composer 2 and Auto use a **Composer usage pool** with generous included usage on Pro plans — they are **not truly unlimited**. Once exhausted, usage is charged at API rates.

| Plan | Composer/Auto Pool | Tab Completions |
|------|-------------------|----------------|
| Pro ($20/mo) | Generous included | Unlimited |
| Pro Plus ($60/mo) | Generous included | Unlimited |
| Ultra ($200/mo) | Generous included | Unlimited |

### Composer 2 Pricing

| Variant | Input | Cache Read | Output |
|---------|-------|-----------|--------|
| Standard | $0.50/M | $0.20/M | $2.50/M |
| Fast (default) | $1.50/M | $0.35/M | $7.50/M |

### Auto + Composer Pool Pricing

When using `auto` or `composer-1.5`:

| Token Type | Price |
|------------|-------|
| Input + Cache Write | $1.25/M |
| Cache Read | $0.25/M |
| Output | $6.00/M |

### Available Models

```bash
curl http://localhost:32124/v1/models | grep composer
```

**Models:**
- `composer-2` — Composer 2 (standard tier)
- `composer-2-fast` — Composer 2 Fast (default, higher throughput)
- `composer-1.5` — Composer 1.5
- `auto` — Auto-select (uses Composer pool)

### Test Composer 2

```bash
curl -X POST http://localhost:32124/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "composer-2",
    "messages": [{"role": "user", "content": "Hello, what model are you?"}],
    "stream": true
  }'
```

### All Available Models

| Model ID | Description | Usage Pool |
|----------|-------------|-----------|
| `auto` | Auto-select best model | Composer |
| `composer-2` | Composer 2 (standard) | Composer |
| `composer-2-fast` | Composer 2 Fast | Composer |
| `composer-1.5` | Composer 1.5 | Composer |
| `sonnet-4.6` | Claude Sonnet 4.6 | API |
| `opus-4.6` | Claude Opus 4.6 | API |
| `gpt-5.2` | GPT-5.2 | API |
| `gpt-5.3-codex` | GPT-5.3 Codex | API |

### Example: Code Review with Composer 2

```bash
curl -X POST http://localhost:32124/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "composer-2-fast",
    "messages": [
      {"role": "system", "content": "You are a code reviewer."},
      {"role": "user", "content": "Review this function:\n\nfunction add(a, b) { return a + b }"}
    ],
    "stream": false
  }'
```

## Client Integration Guides

Choose your client below for detailed configuration:

### [OpenCode](docs/OPENCODE.md)

Configure OpenCode to use CliCursorProxyAPI via `@ai-sdk/openai-compatible`:

```json
{
  "provider": {
    "cursor-acp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cursor ACP",
      "options": {
        "baseURL": "http://127.0.0.1:32124/v1"
      },
      "models": {
        "cursor-acp/auto": { "name": "Auto" },
        "cursor-acp/sonnet-4.6": { "name": "Claude 4.6 Sonnet" },
        "cursor-acp/opus-4.6": { "name": "Claude 4.6 Opus" }
      }
    }
  }
}
```

**See:** [docs/OPENCODE.md](docs/OPENCODE.md) for full guide

---

### [oh-my-pi](docs/OH-MY-PI.md)

Register CliCursorProxyAPI as a provider in oh-my-pi:

```typescript
// ~/.omp/extensions/cursor-acp.ts
pi.registerProvider("cursor-acp", {
  baseUrl: "http://127.0.0.1:32124/v1",
  apiKey: "dummy",  // Ignored; auth handled by cursor-agent
  api: "openai-completions",
  models: [
    { id: "auto", name: "Auto", reasoning: true, ... },
    { id: "sonnet-4.6", name: "Claude 4.6 Sonnet", ... }
  ]
});
```

**See:** [docs/OH-MY-PI.md](docs/OH-MY-PI.md) for full guide

---

### [Factory Droid](docs/FACTORY-DROID.md)

The proxy is already configured in `.factory/services.yaml`:

```yaml
services:
  cursor-proxy:
    name: cursor-proxy
    port: 32124
    start: cd /path/to/CliCursorProxyAPI && bun run proxy
    healthcheck: curl -sf http://localhost:32124/health
```

**See:** [docs/FACTORY-DROID.md](docs/FACTORY-DROID.md) for full guide

---

### [curl](docs/OPENCODE.md#testing-the-integration)

Test directly with curl for any OpenAI-compatible client:

```bash
# Health check
curl http://localhost:32124/health

# List models
curl http://localhost:32124/v1/models

# Chat completions (streaming)
curl -X POST http://localhost:32124/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}],"stream":true}'
```

## API Endpoints

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "version": "2.3.20",
  "auth": "authenticated"
}
```

### GET /v1/models

List available models.

**Response:**
```json
{
  "object": "list",
  "data": [
    { "id": "auto", "name": "Auto" },
    { "id": "sonnet-4.6", "name": "Claude 4.6 Sonnet" },
    { "id": "opus-4.6", "name": "Claude 4.6 Opus" }
  ]
}
```

### POST /v1/chat/completions

Streaming chat completions (OpenAI-compatible).

**Request:**
```json
{
  "model": "auto",
  "messages": [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "Hello"}
  ],
  "stream": true
}
```

**Response:** SSE stream with `data:` prefix and `\n\n` terminator.

## Supported Models

| Model Family | Examples | Thinking Support |
|-------------|----------|------------------|
| **Claude** | opus-4.6, sonnet-4.6, opus-4.5, sonnet-4.5 | ✓ (thinking variants) |
| **GPT** | gpt-5.4-xhigh, gpt-5.3-codex, gpt-5.2 | ✗ |
| **Gemini** | gemini-3.1-pro, gemini-3-pro, gemini-3-flash | ✗ |
| **Special** | auto, composer-1.5, grok, kimi-k2.5 | Varies |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 32124 | Proxy server port |
| `HOST` | 127.0.0.1 | Host to bind to |
| `TOOL_LOOP_MAX_REPEAT` | 2 | Max tool call repeats before error |

**Example:**
```bash
PORT=32125 bun run proxy  # Custom port
```

## Troubleshooting

### Proxy won't start

**Error:** `Port 32124 already in use`

**Solution:**
1. Check what's using the port: `lsof -i :32124`
2. Stop the conflicting process OR use a different port:
   ```bash
   PORT=32125 bun run proxy
   ```

---

### Authentication fails

**Error:** `auth: "not_authenticated"` in health response

**Solution:**
1. Verify cursor-agent is installed: `cursor-agent --version`
2. Login: `cursor-agent login`
3. Verify auth: `curl http://localhost:32124/health`

---

### Model not found

**Error:** `400 Bad Request` with model_not_found

**Solution:**
1. Verify model name is correct (e.g., `auto`, `sonnet-4.6`)
2. Check available models: `curl http://localhost:32124/v1/models`

---

### Streaming stops unexpectedly

**Possible causes:**
1. Authentication expired → Run `cursor-agent login` again
2. Rate limit hit → Wait and retry, or check [cursor.com/settings](https://cursor.com/settings)
3. Tool loop detected → Proxy prevents infinite loops after threshold

---

### Connection refused

**Error:** `Failed to connect to localhost:32124`

**Solution:**
1. Verify proxy is running: `ps aux | grep proxy`
2. Start the proxy: `bun run proxy`
3. Check port: `lsof -i :32124`

---

### Quota exceeded

**Error:** `429 Too Many Requests`

**Solution:**
1. Check usage at [cursor.com/settings](https://cursor.com/settings)
2. Wait for quota reset
3. Reduce request frequency

## Advanced Topics

### MCP Tool Bridge

Any MCP servers configured in OpenCode work automatically through the proxy. The proxy uses `mcptool` CLI to bridge MCP servers into Cursor models.

```bash
# List discovered MCP servers
mcptool servers

# List available tools
mcptool tools [server]

# Call a tool manually
mcptool call hybrid-memory memory_stats
```

### Tool Loop Guard

The proxy includes protection against infinite tool loops. If the same tool is called repeatedly (default: 2 times), the proxy returns an error to prevent runaway loops.

Configure via: `TOOL_LOOP_MAX_REPEAT=3 bun run proxy`

### Remote Server

To run the proxy on a remote server:

1. Start proxy with `HOST=0.0.0.0`:
   ```bash
   HOST=0.0.0.0 bun run proxy
   ```
2. Update client baseURL to `http://your-server:32124/v1`
3. **Security note:** Use firewall rules or VPN to restrict access

## Project Structure

```
CliCursorProxyAPI/
├── src/
│   ├── proxy/
│   │   ├── server.ts           # HTTP server
│   │   ├── handler.ts          # Request routing
│   │   └── standalone-server.ts # Standalone entry
│   ├── streaming/
│   │   ├── parser.ts           # NDJSON → SSE conversion
│   │   ├── line-buffer.ts      # Line buffering
│   │   └── delta-tracker.ts    # Delta tracking
│   ├── auth.ts                 # Authentication
│   └── models/
│       └── sync.ts             # Model list sync
├── docs/
│   ├── OPENCODE.md             # OpenCode integration
│   ├── OH-MY-PI.md             # oh-my-pi integration
│   ├── FACTORY-DROID.md        # Factory Droid integration
│   └── architecture/           # Architecture docs
├── tests/
│   ├── unit/                   # Unit tests
│   └── integration/            # Integration tests
└── package.json
```

## Testing

```bash
# Install dependencies
bun install

# Run all tests
bun test

# Run unit tests only
bun run test:unit

# Typecheck
bun run typecheck

# Lint
bun run lint
```

## Comparison with Alternatives

| Feature | CliCursorProxyAPI | yet-another-opencode-cursor-auth | opencode-cursor-auth |
|---------|------------------|--------------------------------|---------------------|
| **Architecture** | HTTP proxy via cursor-agent | Direct Connect-RPC | HTTP proxy via cursor-agent |
| **Platform** | Linux, macOS | Linux, macOS | Linux, macOS |
| **Max Prompt** | Unlimited (HTTP body) | Unknown | ~128KB (ARG_MAX) |
| **Streaming** | ✓ SSE | ✓ SSE | Undocumented |
| **Tool Calling** | ✓ OpenCode-owned loop | ✓ Native | ✓ Experimental |
| **MCP Bridge** | ✓ mcptool CLI | ✗ | ✗ |

## License

ISC — See [LICENSE](LICENSE)

## References

- [cursor-agent CLI](https://cursor.com)
- [OpenCode](https://opencode.ai)
- [oh-my-pi](https://github.com/can1357/oh-my-pi)
- [Factory Droids](https://github.com/FactoryMachines/factory-droids)
- [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat)
