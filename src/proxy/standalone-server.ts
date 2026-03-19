/**
 * Standalone Proxy Server
 * 
 * A standalone proxy server that enables any OpenAI-compatible client to use
 * Cursor Pro subscription models via cursor-agent.
 * 
 * This server runs independently of the OpenCode plugin architecture and can be
 * started via: bun run proxy or node dist/proxy.js
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCursorAuth } from "../auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use require for CommonJS compatibility
const require = createRequire(import.meta.url);

// Try to load bun's serve, fallback to http server
let isBun = false;
try {
  const bunAny = (globalThis as any).Bun;
  if (bunAny && typeof bunAny.serve === "function") {
    isBun = true;
  }
} catch {
  // Not Bun runtime
}

const DEFAULT_PORT = 32124;
const DEFAULT_HOST = "127.0.0.1";

interface ProxyConfig {
  port?: number;
  host?: string;
}

function stripAnsi(str: string): string {
  if (typeof str !== "string") return String(str ?? "");
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

interface AgentError {
  message: string;
  userMessage: string;
  statusCode: number;
  type: string;
  code: string;
}

function parseAgentError(stderr: string | unknown): AgentError {
  const input = typeof stderr === "string" ? stderr : String(stderr ?? "");
  const clean = stripAnsi(input).trim();

  if (clean.includes("not logged in") || clean.includes("auth") || clean.includes("unauthorized")) {
    return {
      message: clean,
      userMessage: "Not authenticated with Cursor. Run: cursor-agent login",
      statusCode: 401,
      type: "authentication_error",
      code: "not_authenticated",
    };
  }

  if (clean.includes("usage limit") || clean.includes("hit your usage limit") || clean.includes("rate limit")) {
    return {
      message: clean,
      userMessage: "You've hit your Cursor usage or rate limit. Please wait and try again later.",
      statusCode: 429,
      type: "rate_limit_error",
      code: "quota_exceeded",
    };
  }

  if (clean.includes("model not found") || clean.includes("invalid model") || clean.includes("unknown model")) {
    return {
      message: clean,
      userMessage: clean.substring(0, 200) || "Model not available",
      statusCode: 400,
      type: "invalid_request_error",
      code: "model_not_found",
    };
  }

  return {
    message: clean,
    userMessage: clean.substring(0, 200) || "An error occurred",
    statusCode: 500,
    type: "internal_error",
    code: "server_error",
  };
}

function formatSseChunk(payload: object): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function formatSseDone(): string {
  return "data: [DONE]\n\n";
}

function createChunk(id: string, created: number, model: string, delta: object, done = false) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: done ? "stop" : null,
      },
    ],
  };
}

async function fetchModels(): Promise<Array<{ id: string; object: string; created: number; owned_by: string; name: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn("cursor-agent", ["models"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code !== 0 && !stdout) {
        const parsed = parseAgentError(stderr);
        reject(new Error(parsed.userMessage));
        return;
      }

      const models: Array<{ id: string; object: string; created: number; owned_by: string; name: string }> = [];
      const lines = stripAnsi(stdout).split("\n");

      for (const line of lines) {
        // Format: "model-id - Display Name [(current)] [(default)]"
        const match = line.match(/^([a-z0-9.-]+)\s+-\s+(.+?)(?:\s+\((current|default)\))*\s*$/i);
        if (match) {
          models.push({
            id: match[1],
            name: match[2].trim(),
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "cursor",
          });
        }
      }

      resolve(models);
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

function parseStreamLine(line: string): any | null {
  if (!line.trim() || !line.startsWith("{")) {
    return null;
  }

  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isAssistantTextEvent(event: any): boolean {
  return event?.type === "assistant" || event?.type === "assistant_text";
}

function isThinkingEvent(event: any): boolean {
  return event?.type === "thinking" || event?.type === "reasoning";
}

function extractText(event: any): string {
  // Handle nested message.content format: {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
  if (event?.message?.content) {
    const content = event.message.content;
    if (Array.isArray(content)) {
      return content
        .filter((c: any) => c?.type === "text" && typeof c?.text === "string")
        .map((c: any) => c.text)
        .join("");
    }
  }
  // Handle direct formats
  if (typeof event?.text === "string") return event.text;
  if (typeof event?.content === "string") return event.content;
  return "";
}

function extractThinking(event: any): string {
  // Handle nested message.content format for thinking
  if (event?.message?.content) {
    const content = event.message.content;
    if (Array.isArray(content)) {
      return content
        .filter((c: any) => c?.type === "thinking" && typeof c?.thinking === "string")
        .map((c: any) => c.thinking)
        .join("");
    }
  }
  // Handle direct formats
  if (typeof event?.thinking === "string") return event.thinking;
  if (typeof event?.reasoning === "string") return event.reasoning;
  // Handle standalone thinking events: {"type":"thinking","text":"..."}
  if (event?.type === "thinking" && typeof event?.text === "string") return event.text;
  return "";
}

interface StreamState {
  id: string;
  created: number;
  model: string;
  assistantBuffer: string;
  thinkingBuffer: string;
  sawAssistantPartials: boolean;
  sawThinkingPartials: boolean;
}

function processStreamLine(state: StreamState, line: string, controller: any, encoder: any): boolean {
  const event = parseStreamLine(line);
  if (!event) return false;

  const isPartial = typeof event.timestamp_ms === "number";

  if (isAssistantTextEvent(event)) {
    const text = extractText(event);
    if (!text) return false;

    if (isPartial) {
      state.sawAssistantPartials = true;
      const chunk = createChunk(state.id, state.created, state.model, { content: text });
      controller.enqueue(encoder.encode(formatSseChunk(chunk)));
    } else if (!state.sawAssistantPartials) {
      state.assistantBuffer += text;
    }
    return true;
  }

  if (isThinkingEvent(event)) {
    const thinking = extractThinking(event);
    if (!thinking) return false;

    if (isPartial) {
      state.sawThinkingPartials = true;
      const chunk = createChunk(state.id, state.created, state.model, { reasoning_content: thinking });
      controller.enqueue(encoder.encode(formatSseChunk(chunk)));
    } else if (!state.sawThinkingPartials) {
      state.thinkingBuffer += thinking;
    }
    return true;
  }

  return false;
}

/**
 * Authentication error with helpful message
 */
class AuthenticationError extends Error {
  constructor(message: string, public readonly userMessage: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

/**
 * Check if the user is authenticated with cursor-agent
 * Throws AuthenticationError if not authenticated
 */
function requireCursorAuth(): void {
  if (!verifyCursorAuth()) {
    throw new AuthenticationError(
      "Not authenticated with Cursor",
      "Please run 'cursor-agent login' to authenticate with your Cursor account. " +
      "This proxy requires an active Cursor Pro subscription to handle requests."
    );
  }
}

async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  workspaceDir: string,
): Promise<void> {
  // Check authentication before processing
  let authError: AuthenticationError | null = null;
  try {
    requireCursorAuth();
  } catch (err) {
    if (err instanceof AuthenticationError) {
      authError = err;
    } else {
      throw err;
    }
  }

  if (authError) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: {
        message: authError.userMessage,
        type: "authentication_error",
        code: 401,
      }
    }));
    return;
  }

  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    }
  }

  const bodyStr = Buffer.concat(chunks).toString();
  let body: any = {};

  try {
    body = JSON.parse(bodyStr || "{}");
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: {
        message: "Invalid JSON body",
        type: "invalid_request_error",
        code: "invalid_json",
        status: 400,
      }
    }));
    return;
  }

  const messages: Array<any> = Array.isArray(body?.messages) ? body.messages : [];
  const stream = body?.stream === true;
  const model = body?.model || "auto";

  // Validate messages are present
  if (messages.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: {
        message: "messages is required",
        type: "invalid_request_error",
        code: "missing_messages",
        status: 400,
      }
    }));
    return;
  }

  // Build prompt from messages
  const prompt = buildPrompt(messages);
  const id = `cursor-proxy-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  const cmd = [
    "cursor-agent",
    "--print",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--workspace",
    workspaceDir,
    "--trust",
    "--model",
    model,
  ];

  const child = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe", "pipe"] });

  child.stdin.write(prompt);
  child.stdin.end();

  if (!stream) {
    // Non-streaming response
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString().trim();
      const stderr = Buffer.concat(stderrChunks).toString().trim();

      if (code !== 0) {
        // Non-zero exit code always indicates an error, regardless of stdout content
        const parsed = parseAgentError(stderr);
        // Return proper HTTP error with OpenAI error format
        res.writeHead(parsed.statusCode, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: {
            message: parsed.userMessage,
            type: parsed.type,
            code: parsed.code,
            status: parsed.statusCode,
          }
        }));
        return;
      }

      // Extract text from stream output
      let assistantText = "";
      let thinkingText = "";
      const lines = stdout.split("\n");

      for (const line of lines) {
        const event = parseStreamLine(line);
        if (!event) continue;

        if (isAssistantTextEvent(event)) {
          const text = extractText(event);
          if (text) assistantText += text;
        }

        if (isThinkingEvent(event)) {
          const thinking = extractThinking(event);
          if (thinking) thinkingText += thinking;
        }
      }

      const response = {
        id,
        object: "chat.completion",
        created,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: assistantText || stdout || stderr,
              ...(thinkingText ? { reasoning_content: thinkingText } : {}),
            },
            finish_reason: "stop",
          },
        ],
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });

    return;
  }

  // Streaming response
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const encoder = new TextEncoder();
  const state: StreamState = {
    id,
    created,
    model,
    assistantBuffer: "",
    thinkingBuffer: "",
    sawAssistantPartials: false,
    sawThinkingPartials: false,
  };

  const lineBuffer: string[] = [];
  let buffer = "";
  let stderrBuffer = "";

  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      lineBuffer.push(line);
    }
  });

  const processBuffer = () => {
    while (lineBuffer.length > 0) {
      const line = lineBuffer.shift()!;
      const processed = processStreamLine(state, line, { enqueue: (data: Uint8Array) => res.write(data) }, encoder);
      if (!processed) {
        // Check if it's a tool call - forward it as a chunk
        const event = parseStreamLine(line);
        if (event?.type === "tool_call") {
          // event.tool_call is a Record like { "BashToolCall": { args: { command: "ls" } } }
          const toolKey = Object.keys(event.tool_call || {})[0];
          const toolPayload = toolKey ? event.tool_call[toolKey] : null;
          const toolArgs = toolPayload?.args ?? {};

          // Infer tool name from key (e.g., "BashToolCall" -> "bash")
          let toolName = "tool";
          if (toolKey) {
            if (toolKey.endsWith("ToolCall")) {
              toolName = toolKey.slice(0, -"ToolCall".length).toLowerCase();
            } else {
              toolName = toolKey;
            }
          }

          const chunk = createChunk(state.id, state.created, state.model, {
            tool_calls: [{
              index: 0,
              id: event.call_id || "unknown",
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify(toolArgs),
              },
            }],
          });
          res.write(formatSseChunk(chunk));
        }
      }
    }
  };

  child.on("close", (code) => {
    // Check for errors (non-zero exit code with no output)
    if (code !== 0 && !state.sawAssistantPartials && !state.assistantBuffer) {
      const parsed = parseAgentError(stderrBuffer);
      // Log the error for debugging
      console.error(`cursor-agent error (${parsed.statusCode}): ${parsed.message}`);
      // For streaming, we include error info in the chunk
      const errorChunk = createChunk(id, created, model, { 
        content: `cursor-proxy error: ${parsed.userMessage}` 
      }, true);
      res.write(formatSseChunk(errorChunk));
      res.write(formatSseDone());
      res.end();
      return;
    }

    // Process remaining buffer
    if (buffer.trim()) {
      lineBuffer.push(buffer);
      buffer = "";
    }
    processBuffer();

    // Send final buffers if not already sent via partials
    if (!state.sawAssistantPartials && state.assistantBuffer) {
      const chunk = createChunk(state.id, state.created, state.model, { content: state.assistantBuffer });
      res.write(formatSseChunk(chunk));
    }

    if (!state.sawThinkingPartials && state.thinkingBuffer) {
      const chunk = createChunk(state.id, state.created, state.model, { reasoning_content: state.thinkingBuffer });
      res.write(formatSseChunk(chunk));
    }

    const doneChunk = createChunk(state.id, state.created, state.model, {}, true);
    res.write(formatSseChunk(doneChunk));
    res.write(formatSseDone());
    res.end();
  });

  child.on("error", (err) => {
    console.error(`cursor-agent spawn error: ${err.message}`);
    const errorChunk = createChunk(id, created, model, { content: `cursor-proxy error: ${err.message}` }, true);
    res.write(formatSseChunk(errorChunk));
    res.write(formatSseDone());
    res.end();
  });
}

function buildPrompt(messages: Array<any>): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const role = msg.role || "user";
    let content = "";

    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      // Handle content array (e.g., text + images)
      for (const part of msg.content) {
        if (part.type === "text") {
          content += part.text + "\n";
        }
        // Ignore image URLs for now
      }
    }

    if (msg.tool_calls) {
      // Handle tool calls in message
      for (const tc of msg.tool_calls) {
        parts.push(`<tool_call>${tc.function.name}</tool_call>`);
        parts.push(`<tool_arguments>${tc.function.arguments}</tool_arguments>`);
      }
    } else if (msg.tool_call_id) {
      // Tool result message
      parts.push(`<tool_result id="${msg.tool_call_id}">${content}</tool_result>`);
    } else {
      parts.push(`<${role}>${content}</${role}>`);
    }
  }

  return parts.join("\n");
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  workspaceDir: string,
): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  // CORS headers for cross-origin requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint
  if (path === "/health" && req.method === "GET") {
    const isAuthenticated = verifyCursorAuth();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      version: "2.3.20",
      auth: isAuthenticated ? "authenticated" : "not_authenticated"
    }));
    return;
  }

  // Models endpoint
  if ((path === "/v1/models" || path === "/models") && req.method === "GET") {
    try {
      const models = await fetchModels();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: models }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Failed to fetch models: ${message}` }));
    }
    return;
  }

  // Chat completions endpoint
  if ((path === "/v1/chat/completions" || path === "/chat/completions") && req.method === "POST") {
    await handleChatCompletions(req, res, workspaceDir);
    return;
  }

  // Not found
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: `Unsupported path: ${path}` }));
}

export async function startProxyServer(config: ProxyConfig = {}): Promise<{ baseURL: string; stop: () => void }> {
  const port = config.port || DEFAULT_PORT;
  const host = config.host || DEFAULT_HOST;
  const workspaceDir = process.cwd();

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handleRequest(req, res, workspaceDir).catch((err) => {
        console.error("Request handling error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      });
    });

    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use. Try a different port.`);
      }
      reject(err);
    });

    server.listen(port, host, () => {
      const baseURL = `http://${host}:${port}`;
      console.log(`Standalone proxy server started on ${baseURL}`);
      console.log(`Workspace directory: ${workspaceDir}`);
      console.log(`Health endpoint: ${baseURL}/health`);
      console.log(`Models endpoint: ${baseURL}/v1/models`);
      console.log(`Chat endpoint: ${baseURL}/v1/chat/completions`);

      resolve({
        baseURL,
        stop: () => {
          server.close();
          console.log("Proxy server stopped");
        },
      });
    });
  });
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  const port = portArg ? parseInt(portArg.split("=")[1], 10) : DEFAULT_PORT;

  startProxyServer({ port })
    .then(({ stop }) => {
      // Handle graceful shutdown
      const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
      signals.forEach((signal) => {
        process.on(signal, () => {
          console.log(`\nReceived ${signal}, shutting down...`);
          stop();
          process.exit(0);
        });
      });
    })
    .catch((err) => {
      console.error("Failed to start proxy server:", err);
      process.exit(1);
    });
}
