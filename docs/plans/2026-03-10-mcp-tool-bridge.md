# MCP Tool Bridge — Direct MCP Client for Plugin Tool Execution

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable MCP tools configured in OpenCode to be callable by the model when routed through cursor-agent, by connecting directly to MCP servers from the plugin and registering their tools via the `tool` hook.

**Architecture:** The plugin reads MCP server configs from `opencode.json`, spawns direct connections using `@modelcontextprotocol/sdk` (stdio for local servers, HTTP for remote), discovers tools via `listTools()`, and registers each as a plugin `tool()` hook entry whose handler calls `callTool()` on the appropriate MCP client. This bypasses the OpenCode SDK's missing `mcp.tool.invoke()` method entirely.

**Tech Stack:** `@modelcontextprotocol/sdk` (Client, StdioClientTransport), `@opencode-ai/plugin` (tool hook), existing `jsonSchemaToZod()` utility, existing `resolveOpenCodeConfigPath()`.

**Why direct MCP:** Diagnostics confirmed the OpenCode SDK client does NOT expose `tool.invoke()` or `mcp.tool.list()`/`mcp.tool.invoke()`. The only way to reach MCP servers is to connect directly using the MCP protocol.

---

## Diagnostic Findings (context for implementer)

```
hasToolList: true       hasToolInvoke: false
hasMcpToolList: false   hasMcpToolInvoke: false
mcpToolKeys: []         (client.mcp.tool is undefined)
```

The OpenCode SDK `Mcp` class only provides management operations (status, add, connect, disconnect, auth). There is no tool discovery or invocation API. The `McpExecutor` class at `src/tools/executors/mcp.ts` would never have worked — `client.mcp.tool.invoke` doesn't exist.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/plugin.ts:1661-1700` | `buildToolHookEntries()` — pattern for registering tools via `tool()` hook |
| `src/plugin.ts:1499-1555` | `jsonSchemaToZod()` — converts JSON Schema → Zod for tool args |
| `src/plugin.ts:1705-1950` | `CursorPlugin` — main plugin init, where MCP bridge will be wired |
| `src/tools/core/types.ts` | `IToolExecutor`, `ExecutionResult` interfaces |
| `src/tools/executors/mcp.ts` | Current (non-functional) McpExecutor — will be replaced |
| `src/tools/defaults.ts` | 10 local tools — reference for tool registration pattern |
| `src/models/sync.ts` | `autoRefreshModels()` — reference for fire-and-forget startup pattern |
| `~/.config/opencode/opencode.json` | MCP config under `mcp` key |

## MCP SDK Reference

The `@modelcontextprotocol/sdk` package (v1.12.0, proven working via `hybrid-memory`) provides:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'open-cursor', version: '1.0.0' }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: 'node',
  args: ['/path/to/server.js'],
  env: { KEY: 'value' },
});
await client.connect(transport);

const { tools } = await client.listTools();          // discover
const result = await client.callTool({ name, arguments: args }); // invoke
await client.close();                                 // cleanup
```

## MCP Config Shape (from OpenCode SDK types)

```typescript
type McpLocalConfig = {
  type: "local";
  command: Array<string>;               // e.g. ["node", "/path/to/server.js"]
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;                     // default 5000
};

type McpRemoteConfig = {
  type: "remote";
  url: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig | false;
  timeout?: number;
};
```

Real example from user's config:
```json
"mcp": {
  "hybrid-memory": {
    "type": "local",
    "command": ["node", "/home/nomadx/.opencode/hybrid-memory/mcp-server.js"],
    "environment": {
      "OPENCODE_MEMORY_DIR": "/home/nomadx/.opencode/hybrid-memory/data"
    }
  }
}
```

---

## Task 1: Add `@modelcontextprotocol/sdk` dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the dependency**

Run:
```bash
bun add @modelcontextprotocol/sdk@^1.12.0
```

**Step 2: Verify installation**

Run:
```bash
node -e "const { Client } = require('@modelcontextprotocol/sdk/client/index.js'); console.log('MCP SDK loaded:', typeof Client)"
```

Expected: `MCP SDK loaded: function`

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add @modelcontextprotocol/sdk dependency"
```

---

## Task 2: Create MCP config reader

**Files:**
- Create: `src/mcp/config.ts`
- Test: `tests/unit/mcp/config.test.ts`

This module reads MCP server configs from `opencode.json`. It reuses `resolveOpenCodeConfigPath()` from `src/plugin-toggle.ts`.

**Step 1: Write the failing test**

Create `tests/unit/mcp/config.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { readMcpConfigs, type McpServerConfig } from "../../../src/mcp/config.js";

describe("mcp/config", () => {
  it("reads local MCP server configs from valid JSON", () => {
    const json = JSON.stringify({
      mcp: {
        "test-server": {
          type: "local",
          command: ["node", "/path/to/server.js"],
          environment: { KEY: "val" },
        },
      },
    });

    const configs = readMcpConfigs({ configJson: json });
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe("test-server");
    expect(configs[0].type).toBe("local");
    expect(configs[0].command).toEqual(["node", "/path/to/server.js"]);
    expect(configs[0].environment).toEqual({ KEY: "val" });
  });

  it("reads remote MCP server configs", () => {
    const json = JSON.stringify({
      mcp: {
        "remote-srv": {
          type: "remote",
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "Bearer tok" },
        },
      },
    });

    const configs = readMcpConfigs({ configJson: json });
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe("remote-srv");
    expect(configs[0].type).toBe("remote");
    expect(configs[0].url).toBe("https://mcp.example.com/sse");
  });

  it("skips disabled servers", () => {
    const json = JSON.stringify({
      mcp: {
        disabled: { type: "local", command: ["x"], enabled: false },
        enabled: { type: "local", command: ["y"] },
      },
    });

    const configs = readMcpConfigs({ configJson: json });
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe("enabled");
  });

  it("returns empty array when mcp key is missing", () => {
    const configs = readMcpConfigs({ configJson: JSON.stringify({}) });
    expect(configs).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    const configs = readMcpConfigs({ configJson: "{broken" });
    expect(configs).toEqual([]);
  });

  it("reads from file path when configJson not provided", () => {
    const configs = readMcpConfigs({
      existsSync: () => true,
      readFileSync: () =>
        JSON.stringify({
          mcp: { s: { type: "local", command: ["z"] } },
        }),
      env: { OPENCODE_CONFIG: "/tmp/test.json" },
    });
    expect(configs).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mcp/config.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/mcp/config.ts`:

```typescript
import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
} from "node:fs";
import { resolveOpenCodeConfigPath } from "../plugin-toggle.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("mcp:config");

export type McpLocalServerConfig = {
  name: string;
  type: "local";
  command: string[];
  environment?: Record<string, string>;
  timeout?: number;
};

export type McpRemoteServerConfig = {
  name: string;
  type: "remote";
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
};

export type McpServerConfig = McpLocalServerConfig | McpRemoteServerConfig;

interface ReadMcpConfigsDeps {
  configJson?: string;
  existsSync?: (path: string) => boolean;
  readFileSync?: (path: string, enc: BufferEncoding) => string;
  env?: NodeJS.ProcessEnv;
}

export function readMcpConfigs(deps: ReadMcpConfigsDeps = {}): McpServerConfig[] {
  let raw: string;

  if (deps.configJson != null) {
    raw = deps.configJson;
  } else {
    const exists = deps.existsSync ?? nodeExistsSync;
    const readFile = deps.readFileSync ?? nodeReadFileSync;
    const configPath = resolveOpenCodeConfigPath(deps.env ?? process.env);
    if (!exists(configPath)) return [];
    try {
      raw = readFile(configPath, "utf8");
    } catch {
      return [];
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const mcpSection = parsed.mcp;
  if (!mcpSection || typeof mcpSection !== "object" || Array.isArray(mcpSection)) {
    return [];
  }

  const configs: McpServerConfig[] = [];

  for (const [name, entry] of Object.entries(mcpSection as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;

    if (e.enabled === false) continue;

    if (e.type === "local" && Array.isArray(e.command) && e.command.length > 0) {
      configs.push({
        name,
        type: "local",
        command: e.command as string[],
        environment: isStringRecord(e.environment) ? e.environment : undefined,
        timeout: typeof e.timeout === "number" ? e.timeout : undefined,
      });
    } else if (e.type === "remote" && typeof e.url === "string") {
      configs.push({
        name,
        type: "remote",
        url: e.url,
        headers: isStringRecord(e.headers) ? e.headers : undefined,
        timeout: typeof e.timeout === "number" ? e.timeout : undefined,
      });
    } else {
      log.debug("Skipping unrecognised MCP config entry", { name, type: e.type });
    }
  }

  return configs;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mcp/config.test.ts`
Expected: 6 pass, 0 fail

**Step 5: Commit**

```bash
git add src/mcp/config.ts tests/unit/mcp/config.test.ts
git commit -m "feat(mcp): add config reader for MCP server entries"
```

---

## Task 3: Create MCP Client Manager

**Files:**
- Create: `src/mcp/client-manager.ts`
- Test: `tests/unit/mcp/client-manager.test.ts`

This module manages MCP client connections — connecting, discovering tools, invoking tools, and cleaning up.

**Step 1: Write the failing test**

Create `tests/unit/mcp/client-manager.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "bun:test";
import {
  McpClientManager,
  type McpToolInfo,
} from "../../../src/mcp/client-manager.js";
import type { McpLocalServerConfig } from "../../../src/mcp/config.js";

// Mock MCP client that simulates the @modelcontextprotocol/sdk Client
function createMockClient(tools: McpToolInfo[] = []) {
  return {
    connect: vi.fn(async () => {}),
    listTools: vi.fn(async () => ({ tools })),
    callTool: vi.fn(async (params: { name: string; arguments?: Record<string, unknown> }) => ({
      content: [{ type: "text", text: `result for ${params.name}` }],
    })),
    close: vi.fn(async () => {}),
  };
}

function createMockTransport() {
  return { start: vi.fn(), close: vi.fn() };
}

const sampleConfig: McpLocalServerConfig = {
  name: "test-server",
  type: "local",
  command: ["node", "/fake/server.js"],
};

const sampleTools: McpToolInfo[] = [
  {
    name: "memory_store",
    description: "Store a memory",
    inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
];

describe("mcp/client-manager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects to a server and discovers tools", async () => {
    const mockClient = createMockClient(sampleTools);
    const manager = new McpClientManager({
      createClient: () => mockClient as any,
      createTransport: () => createMockTransport() as any,
    });

    await manager.connectServer(sampleConfig);

    const tools = manager.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("memory_store");
    expect(tools[0].serverName).toBe("test-server");
  });

  it("calls a tool on the correct server", async () => {
    const mockClient = createMockClient(sampleTools);
    const manager = new McpClientManager({
      createClient: () => mockClient as any,
      createTransport: () => createMockTransport() as any,
    });

    await manager.connectServer(sampleConfig);
    const result = await manager.callTool("test-server", "memory_store", { key: "hello" });

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: "memory_store",
      arguments: { key: "hello" },
    });
    expect(result).toContain("result for memory_store");
  });

  it("returns error for unknown server", async () => {
    const manager = new McpClientManager({
      createClient: () => createMockClient() as any,
      createTransport: () => createMockTransport() as any,
    });

    const result = await manager.callTool("nonexistent", "tool", {});
    expect(result).toContain("not connected");
  });

  it("disconnects all servers on shutdown", async () => {
    const mockClient = createMockClient(sampleTools);
    const manager = new McpClientManager({
      createClient: () => mockClient as any,
      createTransport: () => createMockTransport() as any,
    });

    await manager.connectServer(sampleConfig);
    await manager.disconnectAll();

    expect(mockClient.close).toHaveBeenCalled();
    expect(manager.listTools()).toHaveLength(0);
  });

  it("handles connection failure gracefully", async () => {
    const mockClient = createMockClient();
    mockClient.connect = vi.fn(async () => {
      throw new Error("spawn failed");
    });

    const manager = new McpClientManager({
      createClient: () => mockClient as any,
      createTransport: () => createMockTransport() as any,
    });

    await manager.connectServer(sampleConfig);
    // Should not throw, just log warning
    expect(manager.listTools()).toHaveLength(0);
  });

  it("handles tool discovery failure gracefully", async () => {
    const mockClient = createMockClient();
    mockClient.listTools = vi.fn(async () => {
      throw new Error("timeout");
    });

    const manager = new McpClientManager({
      createClient: () => mockClient as any,
      createTransport: () => createMockTransport() as any,
    });

    await manager.connectServer(sampleConfig);
    expect(manager.listTools()).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mcp/client-manager.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/mcp/client-manager.ts`:

```typescript
import { createLogger } from "../utils/logger.js";
import type { McpServerConfig } from "./config.js";

const log = createLogger("mcp:client-manager");

const DEFAULT_TIMEOUT_MS = 10000;

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface DiscoveredTool extends McpToolInfo {
  serverName: string;
}

interface ServerConnection {
  client: any;
  tools: McpToolInfo[];
}

interface McpClientManagerDeps {
  createClient: () => any;
  createTransport: (config: McpServerConfig) => any;
}

let defaultDeps: McpClientManagerDeps | null = null;

async function loadDefaultDeps(): Promise<McpClientManagerDeps> {
  if (defaultDeps) return defaultDeps;
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

  defaultDeps = {
    createClient: () =>
      new Client({ name: "open-cursor", version: "1.0.0" }, { capabilities: {} }),
    createTransport: (config: McpServerConfig) => {
      if (config.type === "local") {
        return new StdioClientTransport({
          command: config.command[0],
          args: config.command.slice(1),
          env: { ...process.env, ...(config.environment ?? {}) },
          stderr: "pipe",
        });
      }
      // Remote servers: for now, log and skip.
      // StreamableHTTPClientTransport can be added later.
      throw new Error(`Remote MCP transport not yet implemented for ${config.name}`);
    },
  };
  return defaultDeps;
}

export class McpClientManager {
  private connections = new Map<string, ServerConnection>();
  private deps: McpClientManagerDeps;

  constructor(deps?: McpClientManagerDeps) {
    this.deps = deps ?? {
      createClient: () => {
        throw new Error("MCP SDK not loaded yet — call connectServer after init");
      },
      createTransport: () => {
        throw new Error("MCP SDK not loaded yet");
      },
    };
  }

  async connectServer(config: McpServerConfig): Promise<void> {
    if (this.connections.has(config.name)) {
      log.debug("Server already connected, skipping", { server: config.name });
      return;
    }

    // Lazy-load default deps if none were injected
    if (!this.deps.createClient.toString().includes("open-cursor")) {
      try {
        this.deps = await loadDefaultDeps();
      } catch (err) {
        log.warn("Failed to load MCP SDK", { error: String(err) });
        return;
      }
    }

    let client: any;
    try {
      client = this.deps.createClient();
      const transport = this.deps.createTransport(config);
      await client.connect(transport);
    } catch (err) {
      log.warn("MCP server connection failed", {
        server: config.name,
        error: String(err),
      });
      return;
    }

    let tools: McpToolInfo[] = [];
    try {
      const result = await client.listTools();
      tools = result?.tools ?? [];
      log.info("MCP server connected", {
        server: config.name,
        tools: tools.length,
      });
    } catch (err) {
      log.warn("MCP tool discovery failed", {
        server: config.name,
        error: String(err),
      });
    }

    this.connections.set(config.name, { client, tools });
  }

  listTools(): DiscoveredTool[] {
    const all: DiscoveredTool[] = [];
    for (const [serverName, conn] of this.connections) {
      for (const tool of conn.tools) {
        all.push({ ...tool, serverName });
      }
    }
    return all;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      return `Error: MCP server "${serverName}" not connected`;
    }

    try {
      const result = await conn.client.callTool({
        name: toolName,
        arguments: args,
      });

      // MCP callTool returns { content: Array<{ type, text }> }
      if (Array.isArray(result?.content)) {
        return result.content
          .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
          .join("\n");
      }
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (err: any) {
      log.warn("MCP tool call failed", {
        server: serverName,
        tool: toolName,
        error: String(err?.message || err),
      });
      return `Error: MCP tool "${toolName}" failed: ${err?.message || err}`;
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        await conn.client.close();
        log.debug("MCP server disconnected", { server: name });
      } catch (err) {
        log.debug("MCP server disconnect failed", { server: name, error: String(err) });
      }
    }
    this.connections.clear();
  }

  get connectedServers(): string[] {
    return Array.from(this.connections.keys());
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mcp/client-manager.test.ts`
Expected: 6 pass, 0 fail

**Step 5: Commit**

```bash
git add src/mcp/client-manager.ts tests/unit/mcp/client-manager.test.ts
git commit -m "feat(mcp): add client manager for direct MCP server connections"
```

---

## Task 4: Create MCP Tool Bridge (connects MCP tools to plugin `tool` hook)

**Files:**
- Create: `src/mcp/tool-bridge.ts`
- Test: `tests/unit/mcp/tool-bridge.test.ts`

This module takes discovered MCP tools and creates plugin `tool()` hook entries.

**Step 1: Write the failing test**

Create `tests/unit/mcp/tool-bridge.test.ts`:

```typescript
import { describe, expect, it, vi } from "bun:test";
import { buildMcpToolHookEntries } from "../../../src/mcp/tool-bridge.js";

describe("mcp/tool-bridge", () => {
  it("creates tool hook entries for discovered MCP tools", () => {
    const mockManager = {
      callTool: vi.fn(async () => "result"),
    };

    const tools = [
      {
        name: "memory_store",
        serverName: "hybrid-memory",
        description: "Store a memory",
        inputSchema: {
          type: "object",
          properties: { key: { type: "string" }, value: { type: "string" } },
          required: ["key", "value"],
        },
      },
    ];

    const entries = buildMcpToolHookEntries(tools as any, mockManager as any);

    expect(Object.keys(entries)).toContain("mcp__hybrid_memory__memory_store");
    const entry = entries["mcp__hybrid_memory__memory_store"];
    expect(entry).toBeDefined();
  });

  it("namespaces tool names as mcp__<server>__<tool>", () => {
    const tools = [
      { name: "search", serverName: "my-server", description: "Search" },
      { name: "store", serverName: "my-server", description: "Store" },
    ];

    const entries = buildMcpToolHookEntries(tools as any, { callTool: async () => "" } as any);

    expect(Object.keys(entries)).toEqual([
      "mcp__my_server__search",
      "mcp__my_server__store",
    ]);
  });

  it("handles tools with no inputSchema", () => {
    const tools = [
      { name: "ping", serverName: "srv", description: "Ping" },
    ];

    const entries = buildMcpToolHookEntries(tools as any, { callTool: async () => "pong" } as any);
    expect(Object.keys(entries)).toContain("mcp__srv__ping");
  });

  it("deduplicates tool names across servers", () => {
    const tools = [
      { name: "search", serverName: "server-a", description: "Search A" },
      { name: "search", serverName: "server-b", description: "Search B" },
    ];

    const entries = buildMcpToolHookEntries(tools as any, { callTool: async () => "" } as any);
    expect(Object.keys(entries)).toHaveLength(2);
    expect(Object.keys(entries)).toContain("mcp__server_a__search");
    expect(Object.keys(entries)).toContain("mcp__server_b__search");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mcp/tool-bridge.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/mcp/tool-bridge.ts`:

```typescript
import { tool } from "@opencode-ai/plugin";
import { createLogger } from "../utils/logger.js";
import type { McpClientManager } from "./client-manager.js";

const log = createLogger("mcp:tool-bridge");

interface DiscoveredMcpTool {
  name: string;
  serverName: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Build plugin `tool()` hook entries for discovered MCP tools.
 *
 * Each MCP tool is namespaced as `mcp__<server_name>__<tool_name>`
 * to avoid collision with local tools and to make the source clear.
 */
export function buildMcpToolHookEntries(
  tools: DiscoveredMcpTool[],
  manager: McpClientManager,
): Record<string, any> {
  const z = tool.schema;
  const entries: Record<string, any> = {};

  for (const t of tools) {
    const hookName = namespaceMcpTool(t.serverName, t.name);

    if (entries[hookName]) {
      log.debug("Duplicate MCP tool name, skipping", { hookName });
      continue;
    }

    const zodArgs = mcpSchemaToZod(t.inputSchema, z);
    const serverName = t.serverName;
    const toolName = t.name;

    entries[hookName] = tool({
      description: t.description || `MCP tool: ${t.name} (server: ${t.serverName})`,
      args: zodArgs,
      async execute(args: any) {
        log.debug("Executing MCP tool", { server: serverName, tool: toolName });
        const result = await manager.callTool(serverName, toolName, args ?? {});
        if (result.startsWith("Error:")) {
          throw new Error(result);
        }
        return result;
      },
    });
  }

  log.debug("Built MCP tool hook entries", { count: Object.keys(entries).length });
  return entries;
}

function namespaceMcpTool(serverName: string, toolName: string): string {
  const sanitizedServer = serverName.replace(/[^a-zA-Z0-9]/g, "_");
  const sanitizedTool = toolName.replace(/[^a-zA-Z0-9]/g, "_");
  return `mcp__${sanitizedServer}__${sanitizedTool}`;
}

function mcpSchemaToZod(inputSchema: Record<string, unknown> | undefined, z: any): any {
  if (!inputSchema || typeof inputSchema !== "object") {
    return {};
  }

  const properties = (inputSchema.properties ?? {}) as Record<string, any>;
  const required = (inputSchema.required ?? []) as string[];
  const shape: any = {};

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: any;

    switch (prop?.type) {
      case "string":
        zodType = z.string();
        break;
      case "number":
      case "integer":
        zodType = z.number();
        break;
      case "boolean":
        zodType = z.boolean();
        break;
      case "array":
        zodType = z.array(z.any());
        break;
      case "object":
        zodType = z.record(z.any());
        break;
      default:
        zodType = z.any();
        break;
    }

    if (prop?.description) {
      zodType = zodType.describe(prop.description);
    }

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return shape;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mcp/tool-bridge.test.ts`
Expected: 4 pass, 0 fail

**Step 5: Commit**

```bash
git add src/mcp/tool-bridge.ts tests/unit/mcp/tool-bridge.test.ts
git commit -m "feat(mcp): add tool bridge for registering MCP tools via plugin hook"
```

---

## Task 5: Wire MCP bridge into plugin startup

**Files:**
- Modify: `src/plugin.ts` (~1745-1865)

**Step 1: Add imports**

At the top of `src/plugin.ts`, add after the existing `autoRefreshModels` import (line 27):

```typescript
import { readMcpConfigs } from "./mcp/config.js";
import { McpClientManager } from "./mcp/client-manager.js";
import { buildMcpToolHookEntries } from "./mcp/tool-bridge.js";
```

**Step 2: Add MCP bridge initialization after autoRefreshModels call**

After line 1740 (`autoRefreshModels().catch(() => {});`), add:

```typescript
  // MCP tool bridge: connect to MCP servers and register their tools (fire-and-forget)
  const mcpManager = new McpClientManager();
  const mcpToolEntries: Record<string, any> = {};
  const mcpEnabled = process.env.CURSOR_ACP_MCP_BRIDGE !== "false"; // default ON

  if (mcpEnabled) {
    (async () => {
      try {
        const configs = readMcpConfigs();
        if (configs.length === 0) {
          log.debug("No MCP servers configured, skipping MCP bridge");
          return;
        }
        log.debug("MCP bridge: connecting to servers", { count: configs.length });

        await Promise.allSettled(configs.map((c) => mcpManager.connectServer(c)));

        const tools = mcpManager.listTools();
        if (tools.length === 0) {
          log.debug("MCP bridge: no tools discovered");
          return;
        }

        const entries = buildMcpToolHookEntries(tools, mcpManager);
        Object.assign(mcpToolEntries, entries);
        log.info("MCP bridge: registered tools", {
          servers: mcpManager.connectedServers.length,
          tools: Object.keys(entries).length,
        });
      } catch (err) {
        log.debug("MCP bridge init failed", { error: String(err) });
      }
    })().catch(() => {});
  }
```

**Step 3: Merge MCP tool entries into the returned `tool` hook**

Find the line (around 1864):
```typescript
const toolHookEntries = buildToolHookEntries(localRegistry, workspaceDirectory);
```

Change the returned `tool:` property from:
```typescript
return {
  tool: toolHookEntries,
```

To:
```typescript
return {
  tool: { ...toolHookEntries, ...mcpToolEntries },
```

**Step 4: Verify build succeeds**

Run:
```bash
bun run build
```
Expected: no errors

**Step 5: Run the full test suite**

Run:
```bash
bun test
```
Expected: all existing tests pass, no regressions

**Step 6: Commit**

```bash
git add src/plugin.ts
git commit -m "feat(mcp): wire MCP tool bridge into plugin startup (#38)"
```

---

## Task 6: Integration test — MCP tool discovery and execution

**Files:**
- Create: `tests/unit/mcp/integration.test.ts`

This test exercises the full pipeline: config → manager → bridge → tool hook entry.

**Step 1: Write the integration test**

Create `tests/unit/mcp/integration.test.ts`:

```typescript
import { describe, expect, it, vi } from "bun:test";
import { readMcpConfigs } from "../../../src/mcp/config.js";
import { McpClientManager } from "../../../src/mcp/client-manager.js";
import { buildMcpToolHookEntries } from "../../../src/mcp/tool-bridge.js";

describe("mcp integration", () => {
  it("full pipeline: config → connect → discover → bridge → execute", async () => {
    // 1. Read configs
    const configs = readMcpConfigs({
      configJson: JSON.stringify({
        mcp: {
          "test-memory": {
            type: "local",
            command: ["node", "/fake/server.js"],
          },
        },
      }),
    });
    expect(configs).toHaveLength(1);

    // 2. Connect with mock client
    const callToolFn = vi.fn(async (params: any) => ({
      content: [{ type: "text", text: `stored: ${params.arguments?.key}` }],
    }));

    const manager = new McpClientManager({
      createClient: () => ({
        connect: async () => {},
        listTools: async () => ({
          tools: [
            {
              name: "memory_store",
              description: "Store a value",
              inputSchema: {
                type: "object",
                properties: { key: { type: "string" } },
                required: ["key"],
              },
            },
          ],
        }),
        callTool: callToolFn,
        close: async () => {},
      }),
      createTransport: () => ({ start: async () => {}, close: async () => {} }),
    });

    await manager.connectServer(configs[0]);
    const tools = manager.listTools();
    expect(tools).toHaveLength(1);

    // 3. Build tool hook entries
    const entries = buildMcpToolHookEntries(tools, manager);
    const hookName = "mcp__test_memory__memory_store";
    expect(entries[hookName]).toBeDefined();

    // 4. Simulate tool execution (call the handler)
    // The tool() wrapper returns an object with execute; we test via callTool
    const result = await manager.callTool("test-memory", "memory_store", { key: "hello" });
    expect(result).toBe("stored: hello");
    expect(callToolFn).toHaveBeenCalledWith({
      name: "memory_store",
      arguments: { key: "hello" },
    });

    // 5. Cleanup
    await manager.disconnectAll();
    expect(manager.listTools()).toHaveLength(0);
  });
});
```

**Step 2: Run test**

Run: `bun test tests/unit/mcp/integration.test.ts`
Expected: 1 pass, 0 fail

**Step 3: Run full suite**

Run: `bun test`
Expected: all pass

**Step 4: Commit**

```bash
git add tests/unit/mcp/integration.test.ts
git commit -m "test(mcp): add integration test for full MCP bridge pipeline"
```

---

## Task 7: Build, install, and validate end-to-end

**Files:** None (validation only)

**Step 1: Build**

```bash
bun run build
```

**Step 2: Verify MCP bridge code is in bundle**

```bash
grep -c "mcp:client-manager\|mcp:tool-bridge\|mcp:config" dist/plugin-entry.js
```
Expected: 3+ matches

**Step 3: Install globally**

```bash
npm install -g .
```

**Step 4: Run OpenCode with debug logging**

```bash
CURSOR_ACP_LOG_LEVEL=debug CURSOR_ACP_LOG_CONSOLE=1 timeout 15 opencode run "List your available tools" --dir /home/nomadx/opencode-cursor --model cursor-acp/auto --format json --print-logs --log-level DEBUG 2>&1 | grep -E "mcp:" | head -20
```

Expected output should include:
```
[cursor-acp:mcp:config] ...
[cursor-acp:mcp:client-manager] INFO MCP server connected {"server":"hybrid-memory","tools":N}
[cursor-acp:mcp:tool-bridge] DEBUG Built MCP tool hook entries {"count":N}
[cursor-acp:plugin] INFO MCP bridge: registered tools {"servers":1,"tools":N}
```

**Step 5: Commit version bump if all good**

```bash
npm version patch
git push origin main
git push origin --tags
```

---

## Task 8: Update issue #38 with results

After successful validation, comment on issue #38:

```markdown
MCP tool bridge is now available in v2.3.X.

MCP servers configured in your `opencode.json` (under the `mcp` key) are now automatically connected at plugin startup, their tools are discovered, and registered as callable tools. The model can invoke them directly.

Tool names follow the pattern `mcp__<server>__<tool>` (e.g., `mcp__hybrid_memory__memory_store`).

Disable with `CURSOR_ACP_MCP_BRIDGE=false` if needed.

**Current limitations:**
- Only local (stdio) MCP servers are supported. Remote (HTTP/SSE) support is planned.
- Tool list is static after startup — MCP servers added mid-session require a restart.
- Subagent access is an OpenCode-level feature and is not affected by this change.
```

---

## Known Limitations & Future Work

1. **Remote MCP servers** — `StreamableHTTPClientTransport` exists in the SDK but is not wired up. Add when a user needs it.
2. **Mid-session tool refresh** — Currently tools are discovered once at startup. Could add a periodic refresh or event-driven approach later.
3. **MCP resource access** — `listResources()` / `readResource()` are available on the MCP client but not exposed. Could be useful for context injection.
4. **Timeout handling** — The `timeout` field from MCP config is not yet passed through to `callTool()`. Add when needed.
5. **Fire-and-forget timing** — MCP connections are async. If the model makes a tool call before connections are established, it will fail. The `tool` hook entries are populated via `Object.assign` into a shared object, so they appear as soon as the async init completes. This is a best-effort approach; a more robust solution would defer the `tool` hook return.
