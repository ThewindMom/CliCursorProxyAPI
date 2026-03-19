# CliCursorProxyAPI Architecture

**Universal Cursor Proxy Gateway** — A detailed technical breakdown of the proxy's design, components, and data flows.

---

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Component Details](#component-details)
4. [API Endpoints](#api-endpoints)
5. [Data Flows](#data-flows)
6. [Authentication](#authentication)
7. [Streaming Protocol](#streaming-protocol)
8. [Tool Call System](#tool-call-system)
9. [MCP Bridge](#mcp-bridge)
10. [Configuration](#configuration)
11. [Error Handling](#error-handling)

---

## Overview

CliCursorProxyAPI is a standalone HTTP proxy server that provides OpenAI-compatible REST API access to Cursor Pro subscription models. It acts as a bridge between OpenAI-compatible clients and Cursor's AI models via the `cursor-agent` CLI.

**Key Design Goals:**
- **Standalone operation** — No OpenCode plugin required
- **OpenAI compatibility** — Drop-in replacement for OpenAI API
- **Streaming support** — Real-time SSE responses with full delta updates
- **Tool calling** — Execute local tools and MCP servers through Cursor models
- **Security** — Local-only binding, delegated authentication

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Applications                             │
│   (OpenCode, Factory Droid, oh-my-pi, curl, any OpenAI-compatible client)  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼ HTTP (OpenAI API format)
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CliCursorProxyAPI Proxy                              │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │  /health    │  │ /v1/models  │  │/v1/chat/complet │  │  /v1/tools  │  │
│  │  GET        │  │   GET       │  │     ions POST    │  │    GET      │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  └─────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Request Handler & Router                           │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                      │                                      │
│  ┌───────────────────────────────────▼───────────────────────────────────┐  │
│  │                    cursor-agent Spawner                               │  │
│  │              (spawns CLI per request, handles auth)                  │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│  ┌───────────────────────────────────▼───────────────────────────────────┐  │
│  │                    NDJSON → SSE Converter                            │  │
│  │            (parses stream-json, emits SSE chunks)                    │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│  ┌───────────────────────────────────▼───────────────────────────────────┐  │
│  │                    Tool Loop Guard                                   │  │
│  │           (prevents infinite tool call loops)                        │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│  ┌───────────────────────────────────▼───────────────────────────────────┐  │
│  │                    MCP Bridge (optional)                             │  │
│  │           (connects to MCP servers, executes tools)                  │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
└──────────────────────────────────────┼───────────────────────────────────────┘
                                       │
                                       ▼ STDIN/STDOUT (stream-json)
┌─────────────────────────────────────────────────────────────────────────────┐
│                          cursor-agent CLI                                   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Authentication Module                                              │  │
│  │  (OAuth via browser, token storage, token refresh)                  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                      │                                      │
│  ┌───────────────────────────────────▼───────────────────────────────────┐  │
│  │                    Cursor API Client                                 │  │
│  │              (api2.cursor.sh, agent.api5.cursor.sh)                 │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ HTTPS
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Cursor API                                       │
│                       (api2.cursor.sh, agent.api5.cursor.sh)                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. HTTP Server (`src/proxy/standalone-server.ts`)

The main entry point for the proxy server.

**Responsibilities:**
- Listen for HTTP requests on configurable port (default: 32124)
- Route requests to appropriate handlers
- Manage request/response lifecycle
- Handle CORS headers for cross-origin requests

**Key Functions:**
- `startProxyServer(config)` — Creates and starts the HTTP server
- `handleRequest(req, res, workspaceDir)` — Routes incoming requests
- `handleChatCompletions(req, res, workspaceDir)` — Processes chat API requests

### 2. Authentication (`src/auth.ts`)

Handles authentication via `cursor-agent`.

**Responsibilities:**
- Verify authentication status via `cursor-agent status`
- Detect auth file locations across macOS and Linux
- Support OAuth login flow via `cursor-agent login`

**Key Functions:**
- `verifyCursorAuth()` — Returns `true` if authenticated
- `checkCursorAgentStatus()` — Runs `cursor-agent status` and parses output
- `startCursorOAuth()` — Initiates browser-based OAuth flow

### 3. Model Discovery (`src/models/sync.ts`)

Fetches available models from `cursor-agent`.

**Responsibilities:**
- Execute `cursor-agent models` to get model list
- Parse model output into OpenAI-compatible format

### 4. Streaming (`src/streaming/`)

Converts cursor-agent's NDJSON output to SSE format.

**Files:**
- `parser.ts` — Parses NDJSON lines into events
- `line-buffer.ts` — Buffers incoming data by newlines
- `delta-tracker.ts` — Tracks accumulated deltas for batched updates
- `types.ts` — Type definitions for streaming events
- `openai-sse.ts` — Formats SSE chunks per OpenAI spec

**Key Functions:**
- `parseStreamLine(line)` — Parses a single NDJSON line
- `processStreamLine(state, line, controller, encoder)` — Processes streaming events
- `formatSseChunk(payload)` — Formats data as SSE event

### 5. Tool Loop Guard (`src/proxy/tool-loop.ts`, `src/provider/tool-loop-guard.ts`)

Prevents infinite tool call loops.

**Responsibilities:**
- Track tool calls by fingerprint (tool name + arguments)
- Detect repeated calls with same fingerprint
- Classify outcomes (success, error, validation failure)
- Terminate loop after threshold (configurable, default: 2 repeats)

### 6. MCP Bridge (`src/mcp/`)

Integrates MCP servers for tool execution.

**Files:**
- `client-manager.ts` — Manages MCP client connections
- `config.ts` — Reads MCP server configurations from opencode.json
- `tool-bridge.ts` — Bridges MCP tools to OpenAI function format

**Responsibilities:**
- Connect to MCP servers on startup
- Discover available tools from MCP servers
- Execute MCP tool calls via SDK

---

## API Endpoints

### GET /health

Health check endpoint for monitoring and load balancer probes.

**Request:**
```bash
curl http://localhost:32124/health
```

**Response:**
```json
{
  "status": "ok",
  "version": "2.3.20",
  "auth": "authenticated",
  "mcp": {
    "enabled": true,
    "servers": 2,
    "tools": 15
  }
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Server status (`ok` or `error`) |
| `version` | string | Package version |
| `auth` | string | Authentication state (`authenticated` or `not_authenticated`) |
| `mcp.enabled` | boolean | Whether MCP bridge initialized |
| `mcp.servers` | number | Number of connected MCP servers |
| `mcp.tools` | number | Number of discovered MCP tools |

---

### GET /v1/models

Returns list of available Cursor models in OpenAI format.

**Request:**
```bash
curl http://localhost:32124/v1/models
```

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "auto",
      "name": "Auto",
      "object": "model",
      "created": 1710877200,
      "owned_by": "cursor"
    },
    {
      "id": "sonnet-4.6",
      "name": "Claude 4.6 Sonnet",
      "object": "model",
      "created": 1710877200,
      "owned_by": "cursor"
    }
  ]
}
```

**Notes:**
- Does not require authentication
- Model list comes from `cursor-agent models`

---

### GET /v1/tools

Returns list of available MCP tools.

**Request:**
```bash
curl http://localhost:32124/v1/tools
```

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "mcp__hybrid-memory__memory_stats",
      "name": "memory_stats",
      "server": "hybrid-memory",
      "description": "Get memory statistics",
      "inputSchema": {
        "type": "object",
        "properties": {}
      }
    }
  ],
  "mcp": {
    "servers": 1,
    "tools": 5
  }
}
```

---

### POST /v1/chat/completions

Streaming chat completions endpoint (OpenAI-compatible).

**Request:**
```bash
curl -X POST http://localhost:32124/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "system", "content": "You are helpful."},
      {"role": "user", "content": "Hello"}
    ],
    "stream": true
  }'
```

**Request Fields:**
| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `model` | Yes | string | Model ID (e.g., `auto`, `sonnet-4.6`) |
| `messages` | Yes | array | Array of message objects |
| `stream` | No | boolean | Enable streaming (default: `false`) |
| `temperature` | No | number | Sampling temperature |
| `max_tokens` | No | number | Maximum tokens to generate |

**Message Format:**
```json
{
  "role": "user|assistant|system",
  "content": "string",
  "tool_calls": [...],
  "tool_call_id": "string"
}
```

**Streaming Response (SSE):**
```
data: {"id":"cursor-proxy-1710877200000","object":"chat.completion.chunk","created":1710877200,"model":"auto","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"cursor-proxy-1710877200000","object":"chat.completion.chunk","created":1710877200,"model":"auto","choices":[{"index":0,"delta":{"reasoning_content":"Let me think..."},"finish_reason":null}]}

data: {"id":"cursor-proxy-1710877200000","object":"chat.completion.chunk","created":1710877200,"model":"auto","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"bash","arguments":"{\"command\":\"ls\"}"}}]},"finish_reason":null}]}

data: [DONE]
```

**Delta Types:**
- `delta.content` — Assistant text
- `delta.reasoning_content` — Thinking/reasoning content
- `delta.tool_calls` — Tool call requests

---

## Data Flows

### Chat Completion Flow (Streaming)

```
┌────────┐     HTTP POST /v1/chat/completions      ┌──────────────┐
│        │ ──────────────────────────────────────▶ │              │
│  Client │                                        │   Proxy      │
│        │ ◀────────────────────────────────────── │   Server     │
└────────┘     SSE stream (data: {...}\n\n)        └──────┬───────┘
                                                          │
                                                          │ 1. Parse request
                                                          │ 2. Validate model
                                                          │ 3. Check auth
                                                          ▼
                                                  ┌──────────────┐
                                                  │  Build       │
                                                  │  prompt      │
                                                  └──────┬───────┘
                                                         │
                                                         ▼
                                                  ┌──────────────┐
                                                  │  Spawn       │
                                                  │  cursor-agent│
                                                  │  --print     │
                                                  │  --output-   │
                                                  │  format      │
                                                  │  stream-json │
                                                  └──────┬───────┘
                                                         │
                    ┌────────────────────────────────────┼────┐
                    │                                    │    │
                    ▼                                    ▼    │
              ┌──────────┐                         ┌────────┐ │
              │  STDIN   │                         │ STDOUT │◀┘
              │ (prompt) │                         │(NDJSON)│
              └──────────┘                         └───┬────┘
                                                       │
                          ┌────────────────────────────┼────┐
                          │                            │    │
                          ▼                            ▼    │
                    ┌──────────┐                  ┌─────────┐│
                    │  STDERR  │                  │ Parse   │ │
                    │ (errors) │                  │ NDJSON  │◀┘
                    └──────────┘                  └────┬────┘
                                                        │
                        ┌───────────────────────────────┼────────┐
                        │                               │        │
                        ▼                               ▼        │
                  ┌──────────┐              ┌─────────────────┐ │
                  │ Error    │              │  SSE Converter   │ │
                  │ Handler  │              │  (formatSseChunk)│ │
                  └──────────┘              └────────┬────────┘ │
                                                     │           │
                                                     ▼           │
                                              ┌──────────┐      │
                                              │  HTTP    │      │
                                              │  Response│      │
                                              └──────────┘      │
                                                    SSE stream  │
                                                     to client  │
```

### Tool Call Flow

```
┌────────┐                           ┌──────────────┐              ┌──────────┐
│        │  1. SSE: tool_calls       │              │   2. Tool   │          │
│        │ ─────────────────────────▶│    Client    │ ──────────▶│  OpenCode│
│        │                           │   (caller)    │   execute   │ (or other│
│        │◀──────────────────────────│              │◀────────────│  client) │
│ Client │  4. tool_call result      └──────────────┘   3. Result │          │
└────────┘                           │                             └──────────┘
       │                              │
       │  SSE: delta.tool_calls       │
       │◀─────────────────────────────┤
       │                              │
       │  SSE: [DONE]                 │
       │◀─────────────────────────────┤
```

**Tool Call Sequence:**
1. Cursor model decides to call a tool
2. Proxy sends `delta.tool_calls` event via SSE
3. Client executes the tool locally
4. Client sends result as `role: "tool"` message in next request
5. Proxy forwards to `cursor-agent` for next iteration

---

## Authentication

### Authentication Strategy

The proxy delegates authentication entirely to `cursor-agent`:

```
┌─────────────────────────────────────────────────────────────┐
│                    Authentication Flow                       │
└─────────────────────────────────────────────────────────────┘

1. cursor-agent stores tokens internally (not accessible to proxy)

2. On each request:
   ┌──────────────────────────────────────┐
   │  verifyCursorAuth()                  │
   │  └─▶ spawn("cursor-agent", ["status"])│
   └──────────────────────────────────────┘
            │
            ▼
   ┌──────────────────────────────────────┐
   │  Check stdout for "✓ Logged in"     │
   └──────────────────────────────────────┘
            │
      ┌─────┴─────┐
      │           │
      ▼           ▼
  ┌───────┐  ┌───────────┐
  │  Yes  │  │    No     │
  └───────┘  └───────────┘
      │           │
      │           ▼
      │    ┌──────────────────┐
      │    │ Return 401 with  │
      │    │ helpful error     │
      │    └──────────────────┘
      ▼
   Continue
   with request
```

### Auth File Locations

The proxy checks for auth files in these locations:

**macOS:**
- `~/.cursor/cli-config.json`
- `~/.cursor/auth.json`
- `~/.config/cursor/cli-config.json`
- `~/.config/cursor/auth.json`

**Linux:**
- `~/.config/cursor/cli-config.json`
- `~/.config/cursor/auth.json`
- `$XDG_CONFIG_HOME/cursor/cli-config.json`
- `$XDG_CONFIG_HOME/cursor/auth.json`
- `~/.cursor/cli-config.json`
- `~/.cursor/auth.json`

**Note:** File existence alone does NOT indicate authentication. The proxy uses `cursor-agent status` to verify actual authentication state.

---

## Streaming Protocol

### NDJSON Format (from cursor-agent)

`cursor-agent` outputs events in NDJSON (Newline Delimited JSON) format with `stream-json` output format:

```json
{"type":"assistant","text":"Hello"}
{"type":"thinking","text":"Let me think..."}
{"type":"assistant","message":{"content":[{"type":"text","text":"Here"}]}}
{"type":"tool_call","tool_call":{"BashToolCall":{"args":{"command":"ls"}}},"call_id":"call_123"}
```

### SSE Format (to client)

The proxy converts NDJSON to Server-Sent Events:

```
data: {"id":"...","choices":[{"delta":{"content":"Hello"}}]}\n\n
data: {"id":"...","choices":[{"delta":{"reasoning_content":"Let me think..."}}]}\n\n
data: {"id":"...","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"bash","arguments":"{\"command\":\"ls\"}"}}]}}]}\n\n
data: [DONE]\n\n
```

### Event Type Mapping

| cursor-agent Event | SSE Delta Field | Description |
|-------------------|-----------------|-------------|
| `{"type":"assistant","text":"..."}` | `delta.content` | Assistant text |
| `{"type":"thinking","text":"..."}` | `delta.reasoning_content` | Thinking content |
| `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}` | `delta.content` | Structured text |
| `{"type":"tool_call",...}` | `delta.tool_calls` | Tool call request |
| (end of stream) | `[DONE]` | Stream termination |

---

## Tool Call System

### Tool Loop Guard

The proxy includes protection against infinite tool loops:

**Algorithm:**
```
1. For each tool call, compute fingerprint:
   fingerprint = hash(tool_name + JSON.stringify(args))

2. Maintain state per conversation:
   - repeat_count[fingerprint] = number of calls
   - last_outcome[fingerprint] = success | error | validation_failure

3. On repeat call:
   if repeat_count[fingerprint] >= max_repeat:
     - Terminate stream
     - Return error message
     - Stop cursor-agent process

4. Default max_repeat = 2 (configurable via TOOL_LOOP_MAX_REPEAT)
```

### Tool Name Resolution

The proxy normalizes tool names from cursor-agent to OpenAI format:

| cursor-agent Format | OpenAI Format |
|--------------------|---------------|
| `BashToolCall` | `bash` |
| `ReadFileToolCall` | `read` |
| `WriteFileToolCall` | `write` |
| `EditFileToolCall` | `edit` |
| `GrepToolCall` | `grep` |

### Prompt Format for Tool Results

When client sends tool results back, proxy formats them for cursor-agent:

```xml
<tool_result id="call_123">Tool output here</tool_result>
```

---

## MCP Bridge

### Overview

The MCP (Model Context Protocol) bridge allows MCP servers configured in `opencode.json` to provide tools to Cursor models.

### Configuration

MCP servers are discovered from `opencode.json`:

```json
{
  "mcpServers": {
    "hybrid-memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-hybrid-memory"]
    }
  }
}
```

### MCP Tool Naming

MCP tools are namespaced to avoid conflicts:

```
mcp__serverName__toolName
Example: mcp__hybrid-memory__memory_stats
```

### Tool Execution Flow

```
┌────────────┐     List Tools       ┌──────────────┐
│   Proxy    │ ──────────────────▶ │  MCP Client  │
│            │                     │  Manager      │
└────────────┘                     └───────┬──────┘
                                            │
                                            ▼
                                   ┌──────────────┐
                                   │  MCP Server  │
                                   │  (process)   │
                                   └──────────────┘
                                            │
                                            ▼
                                   ┌──────────────┐
                                   │ Tool Result  │
                                   └──────┬───────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │   Proxy      │
                                   │  (forward)   │
                                   └──────────────┘
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 32124 | Proxy server port |
| `HOST` | 127.0.0.1 | Host to bind to |
| `TOOL_LOOP_MAX_REPEAT` | 2 | Max tool call repeats before error |
| `CURSOR_ACP_AUTH_CHECK_TIMEOUT` | 5000 | Auth check timeout (ms) |

### CLI Arguments

```bash
# Start on default port (32124)
bun run proxy

# Start on custom port
PORT=32125 bun run proxy
bun run proxy --port=32125

# Start on custom host
HOST=0.0.0.0 bun run proxy
```

### Runtime Configuration

```typescript
import { startProxyServer } from "./src/proxy/standalone-server.js";

const { baseURL, stop } = await startProxyServer({
  port: 32124,
  host: "127.0.0.1"
});
```

---

## Error Handling

### Error Response Format

All errors follow OpenAI error format:

```json
{
  "error": {
    "message": "Human-readable error message",
    "type": "invalid_request_error",
    "code": "model_not_found",
    "status": 400
  }
}
```

### Error Codes

| HTTP Status | Error Type | Code | Description |
|-------------|------------|------|-------------|
| 400 | `invalid_request_error` | `model_not_found` | Unknown model requested |
| 400 | `invalid_request_error` | `invalid_json` | Malformed request body |
| 400 | `invalid_request_error` | `missing_messages` | No messages provided |
| 401 | `authentication_error` | `not_authenticated` | Not logged in via cursor-agent |
| 429 | `rate_limit_error` | `quota_exceeded` | Usage or rate limit hit |
| 500 | `internal_error` | `server_error` | Unexpected server error |

### Error Detection from cursor-agent

The proxy parses `cursor-agent` stderr/stdout to classify errors:

| Error Pattern | HTTP Status | Code |
|--------------|-------------|------|
| `not logged in`, `auth`, `unauthorized` | 401 | `not_authenticated` |
| `usage limit`, `rate limit`, `quota` | 429 | `quota_exceeded` |
| `model not found`, `invalid model`, `unknown model` | 400 | `model_not_found` |
| (other) | 500 | `server_error` |

---

## Security Considerations

### Network Binding

- Default bind address is `127.0.0.1` (localhost only)
- For remote access, explicitly bind to `0.0.0.0` with firewall rules

### Authentication

- All authentication is delegated to `cursor-agent`
- Tokens are never stored or logged by the proxy
- Auth state is verified via `cursor-agent status` on each request

### Input Validation

- Request body is validated as JSON before processing
- Model names are validated against available models before auth check
- Tool arguments are parsed and validated

---

## Project Structure

```
CliCursorProxyAPI/
├── src/
│   ├── proxy/
│   │   ├── standalone-server.ts   # Main HTTP server entry point
│   │   ├── server.ts             # Bun-based server creation
│   │   ├── handler.ts            # Request routing
│   │   ├── prompt-builder.ts     # Build prompts for cursor-agent
│   │   ├── tool-loop.ts          # Tool call extraction/normalization
│   │   └── types.ts              # Type definitions
│   ├── streaming/
│   │   ├── parser.ts             # NDJSON parsing
│   │   ├── line-buffer.ts        # Line buffering
│   │   ├── delta-tracker.ts      # Delta accumulation
│   │   ├── openai-sse.ts         # SSE formatting
│   │   └── types.ts              # Streaming type definitions
│   ├── auth.ts                    # Authentication verification
│   ├── models/
│   │   ├── sync.ts               # Model list sync
│   │   ├── discovery.ts          # Model discovery
│   │   └── config.ts             # Model config
│   ├── mcp/
│   │   ├── client-manager.ts     # MCP client management
│   │   ├── config.ts             # MCP config reading
│   │   └── tool-bridge.ts        # MCP tool bridging
│   ├── provider/
│   │   ├── tool-loop-guard.ts    # Loop guard logic
│   │   ├── boundary.ts           # Provider boundary
│   │   ├── runtime-interception.ts
│   │   └── tool-schema-compat.ts
│   └── utils/
│       ├── logger.ts             # Logging utility
│       └── errors.ts             # Error utilities
├── dist/                         # Compiled output
├── tests/
│   ├── unit/                     # Unit tests
│   └── integration/              # Integration tests
├── docs/
│   ├── OPENCODE.md               # OpenCode integration guide
│   ├── OH-MY-PI.md               # oh-my-pi integration guide
│   ├── FACTORY-DROID.md          # Factory Droid integration guide
│   └── architecture/             # Additional architecture docs
├── package.json
├── tsconfig.json
└── ARCHITECTURE.md               # This file
```

---

## Dependencies

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.12.0 | MCP client SDK |
| `@opencode-ai/plugin` | 1.1.53 | OpenCode plugin interface |
| `@opencode-ai/sdk` | 1.1.53 | OpenCode SDK |
| `ai` | ^6.0.55 | AI SDK for streaming |
| `strip-ansi` | ^7.1.0 | ANSI code stripping |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.8.0 | TypeScript compiler |
| `@types/node` | ^22.0.0 | Node.js types |
| `bun-types` | ^1.1.0 | Bun type definitions |

---

## Future Considerations

### Planned Improvements

1. **Token usage tracking** — Report actual token usage from Cursor API
2. **WebSocket support** — Alternative to SSE for certain clients
3. **Metrics endpoint** — Prometheus-compatible metrics for monitoring
4. **Request caching** — Cache model lists and common responses

### Known Limitations

1. **Auth polling** — Auth check is synchronous; could be cached briefly
2. **No streaming backpressure** — Large responses may buffer in memory
3. **Single workspace** — Uses current working directory for all requests

---

*Document Version: 2.3.20*  
*Last Updated: 2026-03-19*
