# Factory Droid Integration Guide

This document describes how Factory Droid (ECC's agent orchestration system) integrates with CliCursorProxyAPI via the `.factory/services.yaml` manifest file, enabling automatic service discovery, health checking, and lifecycle management.

## Overview

Factory Droid uses a declarative manifest (`.factory/services.yaml`) to manage services. The CliCursorProxyAPI proxy server is already configured as a service in this manifest, allowing Factory Droid to:

- Automatically discover the proxy service
- Start the proxy on the configured port (32124)
- Verify health via `/health` endpoint
- Stop the proxy cleanly
- Track service dependencies

## Services.yaml Format

The `cursor-proxy` service is defined in `.factory/services.yaml`:

```yaml
services:
  cursor-proxy:
    name: cursor-proxy
    description: Standalone proxy server for Cursor API
    type: web-server
    port: 32124
    host: 127.0.0.1
    start: |
      cd /Users/thewindmom/Developer/01_Random_Coding/opencode-cursor && bun run proxy
    stop: |
      pkill -f "bun run proxy" || pkill -f "standalone-server" || true
    healthcheck: |
      curl -sf http://localhost:32124/health || exit 1
    depends_on: []
    notes: |
      Requires cursor-agent to be installed and authenticated.
      Run `cursor-agent login` if health check fails with auth error.
```

### Service Fields

| Field | Description |
|-------|-------------|
| `name` | Unique service identifier |
| `description` | Human-readable description |
| `type` | Service type (e.g., `web-server`) |
| `port` | Port number for conflict detection |
| `host` | Host binding address |
| `start` | Command to start the service |
| `stop` | Command to stop the service |
| `healthcheck` | Command to verify service health |
| `depends_on` | Array of service dependencies |
| `notes` | Additional documentation |

## Using the Service Manifest

### Starting the Proxy

Factory Droid can start the proxy using the manifest:

```bash
# Using the start command from services.yaml
cd /Users/thewindmom/Developer/01_Random_Coding/opencode-cursor && bun run proxy
```

Or via the healthcheck command to verify it's running:

```bash
curl -sf http://localhost:32124/health || exit 1
```

### Health Verification

The proxy's `/health` endpoint returns service status:

```bash
curl http://localhost:32124/health
```

Response:
```json
{
  "status": "ok",
  "version": "2.3.20",
  "auth": "not_authenticated",
  "mcp": {
    "enabled": false,
    "servers": 0,
    "tools": 0
  }
}
```

The `auth` field indicates cursor-agent authentication status:
- `"authenticated"` - cursor-agent login completed
- `"not_authenticated"` - no valid auth found

### Stopping the Proxy

```bash
pkill -f "bun run proxy" || pkill -f "standalone-server" || true
```

## Integration with Factory Droid Workflows

### Agent Session Startup

When a Factory Droid agent session starts:

1. The manifest is loaded from `.factory/services.yaml`
2. Services are discovered and cataloged
3. Dependencies are resolved
4. Services can be started on-demand

### Using the Proxy in Agent Sessions

Agents can access the proxy at `http://127.0.0.1:32124`:

```bash
# List available models
curl http://localhost:32124/v1/models

# Send chat completions request
curl -X POST http://localhost:32124/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### Configuring AI Clients to Use the Proxy

Factory Droid agents can configure AI clients to use the proxy:

```json
{
  "provider": {
    "cursor-acp": {
      "options": {
        "baseURL": "http://127.0.0.1:32124/v1"
      }
    }
  }
}
```

## Prerequisites

1. **Bun runtime**: Required to run the proxy
   ```bash
   # Verify bun is installed
   bun --version
   ```

2. **cursor-agent installed**: Required for authentication
   ```bash
   # Install cursor-agent
   curl https://cursor.com/install -fsS | bash
   
   # Verify installation
   cursor-agent --version
   ```

3. **cursor-agent authenticated**: Required for API access
   ```bash
   cursor-agent login
   ```

## Verification Steps

### 1. Verify Service Configuration

Check that `.factory/services.yaml` contains the `cursor-proxy` service:

```bash
grep -A 15 "cursor-proxy:" .factory/services.yaml
```

### 2. Verify Proxy is Accessible

```bash
curl -sf http://localhost:32124/health && echo "Proxy is accessible"
```

### 3. Verify Model List

```bash
curl -s http://localhost:32124/v1/models | head -c 500
```

Expected: JSON array of model objects with `id` and `name` fields

### 4. Verify Chat Completions

```bash
curl -s -X POST http://localhost:32124/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"test"}],"stream":false}' \
  | head -c 200
```

## Service Lifecycle Management

### Start Service

```bash
# Direct start
cd /Users/thewindmom/Developer/01_Random_Coding/opencode-cursor && bun run proxy &

# Or use pkill-safe method
(cd /Users/thewindmom/Developer/01_Random_Coding/opencode-cursor && bun run proxy) &
```

### Check Service Status

```bash
# Health check
curl -sf http://localhost:32124/health

# Process check
ps aux | grep "bun run proxy" | grep -v grep
```

### Stop Service

```bash
# Graceful stop using pkill pattern matching
pkill -f "bun run proxy" || pkill -f "standalone-server" || true
```

## Environment Variables

The proxy supports these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 32124 | Proxy server port |
| `HOST` | 127.0.0.1 | Host to bind to |
| `TOOL_LOOP_MAX_REPEAT` | 2 | Max tool call repeats before error |

Example with custom port:

```bash
PORT=32125 bun run proxy
```

## Troubleshooting

### Health Check Fails

1. Verify proxy is running:
   ```bash
   ps aux | grep proxy
   ```

2. Check port availability:
   ```bash
   lsof -i :32124
   ```

3. Review proxy logs for errors

### Authentication Errors

1. Verify cursor-agent is installed:
   ```bash
   cursor-agent --version
   ```

2. Login to cursor-agent:
   ```bash
   cursor-agent login
   ```

3. Check auth status:
   ```bash
   curl http://localhost:32124/health | jq .auth
   ```

### Port Already in Use

If port 32124 is already in use:

1. Find the conflicting process:
   ```bash
   lsof -i :32124
   ```

2. Stop the conflicting process OR use a different port:
   ```bash
   PORT=32125 bun run proxy
   ```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Factory Droid                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  .factory/services.yaml                              │  │
│  │  ┌───────────────────────────────────────────────┐  │  │
│  │  │ cursor-proxy:                                 │  │  │
│  │  │   port: 32124                                 │  │  │
│  │  │   healthcheck: curl localhost:32124/health    │  │  │
│  │  └───────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               CliCursorProxyAPI (port 32124)               │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  /health     │  │  /v1/models  │  │  /v1/chat/     │  │
│  │  GET         │  │  GET         │  │  completions   │  │
│  └──────────────┘  └──────────────┘  │  POST          │  │
│                                        └────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      cursor-agent                           │
│              (CLI authentication wrapper)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Cursor API     │
                    │ (api2.cursor.sh)│
                    └─────────────────┘
```

## Adding Custom Commands

To add additional commands to the manifest for Factory Droid use:

```yaml
commands:
  test: bun test
  typecheck: bun run typecheck
  lint: bun run lint
```

Factory Droid can then run these via:

```bash
# Run tests
bun test

# Run typecheck
bun run typecheck
```

## Security Considerations

- The proxy binds to `127.0.0.1` (localhost only) by default
- Authentication is handled by cursor-agent CLI, not stored by proxy
- No API keys are stored in the proxy
- Port 32124 is within the mission's allowed port range (32100-32199)
- Use firewall rules for remote access scenarios
