# Task Tool Guard + Schema Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the tool loop guard being too aggressive for parallel `task` calls, and inject valid `subagent_type` values into the model's context so it stops generating validation errors.

**Architecture:** Two independent fixes: (1) raise the strict error-path threshold for `task` (and all EXPLORATION_TOOLS) by applying the existing 5x multiplier inside `evaluateWithFingerprints`, and (2) read agent names from `opencode.json` and inject them as system message guidance so the model knows what string to pass as `subagent_type`.

**Tech Stack:** TypeScript, Bun test runner (`bun test`), existing `src/provider/tool-loop-guard.ts`, `src/mcp/config.ts`, `src/plugin.ts`, `src/proxy/prompt-builder.ts`

**Spec:** `docs/superpowers/specs/2026-03-17-task-tool-guard-and-schema-fix.md`

---

## File Map

| File | Change |
|------|--------|
| `src/provider/tool-loop-guard.ts` | Modify `evaluateWithFingerprints` to use `effectiveMaxRepeat`; add `"task"` to `EXPLORATION_TOOLS` |
| `src/mcp/config.ts` | Add `readSubagentNames()` export |
| `src/plugin.ts` | Pass `subagentNames` to `buildAvailableToolsSystemMessage`; pass to `buildPromptFromMessages` |
| `src/proxy/prompt-builder.ts` | Accept optional `subagentNames` param; append task guidance |
| `tests/unit/provider-tool-loop-guard.test.ts` | Update `ISSUE_51` test; add new guard threshold tests |
| `tests/unit/mcp-config.test.ts` | Add `readSubagentNames()` unit tests (create file if absent) |
| `tests/unit/proxy-prompt-builder.test.ts` | Add `buildPromptFromMessages` injection tests (create file if absent) |

---

## Chunk 1: Guard threshold fix

### Task 1: Add `task` to `EXPLORATION_TOOLS` and fix `evaluateWithFingerprints`

**Files:**
- Modify: `src/provider/tool-loop-guard.ts:37-47` (EXPLORATION_TOOLS set)
- Modify: `src/provider/tool-loop-guard.ts:495-542` (`evaluateWithFingerprints` function)
- Modify: `tests/unit/provider-tool-loop-guard.test.ts:663-703` (update ISSUE_51 test)
- Test: `tests/unit/provider-tool-loop-guard.test.ts`

- [ ] **Step 1: Update `ISSUE_51` test to reflect new expected behaviour**

  The existing `ISSUE_51` test (line 663) seeds 1 historical failure in the guard constructor (a `tool` message with a validation error) and then calls `guard.evaluate` 3 times. Replace the entire test — use an empty history (`[]`) so counts start at 0 and the arithmetic is unambiguous:

  ```typescript
  it("ISSUE_51: task tool validation errors should not trigger guard for small batches", () => {
    // After fix: task is in EXPLORATION_TOOLS, strict threshold = maxRepeat * 5 = 10
    // Use empty history — seeded count from constructor would offset all assertions
    const guard = createToolLoopGuard([], 2);

    const taskCall = {
      id: "task-1",
      type: "function" as const,
      function: {
        name: "task",
        arguments: JSON.stringify({ subagent_type: undefined, prompt: "analyze repo" }),
      },
    };

    // 10 identical calls: count=10 is NOT > effectiveMaxRepeat(10), no trigger
    let last!: ReturnType<typeof guard.evaluate>;
    for (let i = 0; i < 10; i++) {
      last = guard.evaluate(taskCall);
      expect(last.triggered).toBe(false);
    }
    expect(last.repeatCount).toBe(10);
    expect(last.maxRepeat).toBe(10); // effectiveMaxRepeat = 2 * EXPLORATION_LIMIT_MULTIPLIER(5)
    expect(last.errorClass).toBe("validation");

    // 11th call: count=11 > 10, first trigger
    const d11 = guard.evaluate(taskCall);
    expect(d11.triggered).toBe(true);
    expect(d11.repeatCount).toBe(11);
    expect(d11.maxRepeat).toBe(10);
  });
  ```

- [ ] **Step 2: Add new focused guard threshold tests**

  After the updated `ISSUE_51` test, add two describe blocks — one for threshold behaviour, one for coarse tracking:

  ```typescript
  describe("EXPLORATION_TOOLS error-path threshold", () => {
    it("task: 5 identical validation failures do not trigger", () => {
      const guard = createToolLoopGuard([], 2);
      const call = { id: "t1", type: "function" as const, function: { name: "task", arguments: '{"prompt":"x"}' } };
      for (let i = 0; i < 5; i++) {
        const d = guard.evaluate(call);
        expect(d.triggered).toBe(false);
        expect(d.maxRepeat).toBe(10); // effectiveMaxRepeat returned in decision
      }
    });

    it("task: 11 identical validation failures trigger (first trigger)", () => {
      const guard = createToolLoopGuard([], 2);
      const call = { id: "t1", type: "function" as const, function: { name: "task", arguments: '{"prompt":"x"}' } };
      for (let i = 0; i < 10; i++) guard.evaluate(call);
      const d11 = guard.evaluate(call);
      expect(d11.triggered).toBe(true);
      expect(d11.repeatCount).toBe(11);
      expect(d11.maxRepeat).toBe(10); // MUST be effectiveMaxRepeat, not raw 2
    });

    it("read (existing EXPLORATION_TOOL): 5 tool_error failures do not trigger (error-path parity)", () => {
      // Before this fix: only success path got 5x. After: error path also gets 5x.
      // Use empty history so counts start at zero.
      const guard = createToolLoopGuard([], 2);
      const call = { id: "r1", type: "function" as const, function: { name: "read", arguments: '{"path":"foo.ts"}' } };
      for (let i = 0; i < 5; i++) {
        const d = guard.evaluate(call);
        expect(d.triggered).toBe(false);
        expect(d.maxRepeat).toBe(10);
      }
    });

    it("edit (non-exploration tool): 3 identical failures trigger (unchanged)", () => {
      const guard = createToolLoopGuard([], 2);
      const call = { id: "e1", type: "function" as const, function: { name: "edit", arguments: '{"path":"f.ts"}' } };
      guard.evaluate(call);
      guard.evaluate(call);
      const d3 = guard.evaluate(call);
      expect(d3.triggered).toBe(true);
      expect(d3.maxRepeat).toBe(2); // raw maxRepeat, no multiplier
    });

    it("evaluateValidation for task: 11 failures trigger (fix applies to validation path too)", () => {
      // evaluateValidation calls evaluateWithFingerprints — same fix applies
      const guard = createToolLoopGuard([], 2);
      const call = { id: "t1", type: "function" as const, function: { name: "task", arguments: '{}' } };
      const sig = "path:subagent_type|invalid_type";
      for (let i = 0; i < 10; i++) {
        const d = guard.evaluateValidation(call, sig);
        expect(d.triggered).toBe(false);
      }
      const d11 = guard.evaluateValidation(call, sig);
      expect(d11.triggered).toBe(true);
      expect(d11.maxRepeat).toBe(10);
    });
  });

  describe("EXPLORATION_TOOLS coarse tracking", () => {
    it("task: 5 calls with DIFFERENT arg shapes same error class do not trigger (coarse disabled)", () => {
      // Key: each call has a unique prompt → unique strict fingerprint → strict count=1 each
      // Coarse fingerprint would be "task|validation" for all 5 — but coarse is disabled for task
      // If coarse were NOT disabled, coarse count would be 5 and trigger at coarseMax=6 on 7th call
      const guard = createToolLoopGuard([], 2);
      for (let i = 0; i < 5; i++) {
        // Different arguments = different strict fingerprint = different arg shape hash
        const call = {
          id: `t${i}`,
          type: "function" as const,
          function: { name: "task", arguments: JSON.stringify({ prompt: `unique prompt ${i}` }) },
        };
        const d = guard.evaluate(call);
        expect(d.triggered).toBe(false);
      }
    });

    it("write (non-exploration tool): 7 different-fingerprint calls same error class trigger via coarse", () => {
      // coarseMaxRepeat = maxRepeat(2) * COARSE_LIMIT_MULTIPLIER(3) = 6
      // Need > 6 to trigger coarse. Use 7 calls with distinct arg shapes.
      const guard = createToolLoopGuard([], 2);
      let last!: ReturnType<typeof guard.evaluate>;
      for (let i = 0; i < 7; i++) {
        // Each call has a unique path → unique strict fingerprint → strict count stays at 1
        // Coarse fingerprint "write|validation" accumulates to 7 → 7 > 6 → coarse triggers
        const call = {
          id: `w${i}`,
          type: "function" as const,
          function: { name: "write", arguments: JSON.stringify({ path: `file${i}.ts`, content: "x" }) },
        };
        last = guard.evaluate(call);
      }
      expect(last.triggered).toBe(true); // coarse: count=7 > coarseMax=6
    });
  });
  ```

- [ ] **Step 3: Run tests — verify all new tests fail with current code**

  ```bash
  bun test tests/unit/provider-tool-loop-guard.test.ts 2>&1 | grep -E "FAIL|PASS|error"
  ```

  Expected: multiple FAILs for the new tests (ISSUE_51 and the new describe block) — confirms they're testing real behaviour.

- [ ] **Step 4: Implement Part A — add `"task"` to `EXPLORATION_TOOLS` in `tool-loop-guard.ts`**

  In `src/provider/tool-loop-guard.ts`, find `EXPLORATION_TOOLS` (line ~37) and add `"task"`:

  ```typescript
  const EXPLORATION_TOOLS = new Set([
    "read",
    "grep",
    "glob",
    "ls",
    "stat",
    "semsearch",
    "bash",
    "shell",
    "webfetch",
    "task",   // <-- add this
  ]);
  ```

- [ ] **Step 5: Implement Part B — fix `evaluateWithFingerprints` to use `effectiveMaxRepeat`**

  In `src/provider/tool-loop-guard.ts`, find `evaluateWithFingerprints` (line ~495). There are **three** changes to make in this block (lines ~514–528). All three are critical:

  1. Add `isExplorationTool` and `effectiveMaxRepeat` computation **before** the count increment
  2. Use `effectiveMaxRepeat` (not `maxRepeat`) in the `strictTriggered` check
  3. Return `maxRepeat: effectiveMaxRepeat` (not `maxRepeat`) in the early-return object — **this is load-bearing**: callers use `decision.maxRepeat` to compute the soft/hard kill boundary

  **Before (lines ~514–528):**
  ```typescript
  const strictRepeatCount = (strictCounts.get(strictFingerprint) ?? 0) + 1;
  strictCounts.set(strictFingerprint, strictRepeatCount);
  const strictTriggered = strictRepeatCount > maxRepeat;

  const isExplorationTool = EXPLORATION_TOOLS.has(toolName.toLowerCase());
  if (isExplorationTool) {
    return {
      fingerprint: strictFingerprint,
      repeatCount: strictRepeatCount,
      maxRepeat,              // ← BUG: raw maxRepeat, not effective
      errorClass,
      triggered: strictTriggered,   // ← BUG: computed from raw maxRepeat
      tracked: true,
    };
  }
  ```

  **After:**
  ```typescript
  const isExplorationTool = EXPLORATION_TOOLS.has(toolName.toLowerCase());
  const effectiveMaxRepeat = isExplorationTool
    ? maxRepeat * EXPLORATION_LIMIT_MULTIPLIER
    : maxRepeat;

  const strictRepeatCount = (strictCounts.get(strictFingerprint) ?? 0) + 1;
  strictCounts.set(strictFingerprint, strictRepeatCount);
  const strictTriggered = strictRepeatCount > effectiveMaxRepeat;  // ← uses effectiveMaxRepeat

  if (isExplorationTool) {
    return {
      fingerprint: strictFingerprint,
      repeatCount: strictRepeatCount,
      maxRepeat: effectiveMaxRepeat,  // ← MUST be effectiveMaxRepeat (not maxRepeat)
      errorClass,
      triggered: strictTriggered,
      tracked: true,
    };
  }
  ```

  The rest of the function (coarse logic) is unchanged. The coarse path also uses `maxRepeat` for `coarseMaxRepeat = maxRepeat * COARSE_LIMIT_MULTIPLIER` — this is already computed by the caller, not inside this function, so no change needed there.

- [ ] **Step 6: Run tests — verify guard tests pass**

  ```bash
  bun test tests/unit/provider-tool-loop-guard.test.ts 2>&1 | tail -20
  ```

  Expected: all tests PASS including updated ISSUE_51 and new describe block.

- [ ] **Step 7: Run full test suite — verify no regressions**

  ```bash
  bun test 2>&1 | tail -20
  ```

  Expected: all tests pass.

- [ ] **Step 8: Commit**

  ```bash
  git add src/provider/tool-loop-guard.ts tests/unit/provider-tool-loop-guard.test.ts
  git commit -m "fix(guard): raise exploration tools error-path threshold to 5x, add task to EXPLORATION_TOOLS"
  ```

---

## Chunk 2: `readSubagentNames()` and system prompt injection

### Task 2: Add `readSubagentNames()` to `src/mcp/config.ts`

**Files:**
- Modify: `src/mcp/config.ts` (add export)
- Test: `tests/unit/mcp-config.test.ts` (create or extend)

- [ ] **Step 1: Check if `tests/unit/mcp-config.test.ts` exists**

  ```bash
  ls tests/unit/mcp-config.test.ts 2>/dev/null || echo "not found"
  ```

  If not found, create it with this skeleton (the full tests go in step 3):

  ```typescript
  import { describe, it, expect } from "bun:test";
  import { readMcpConfigs, readSubagentNames } from "../../src/mcp/config.js";

  describe("readSubagentNames", () => {
    // tests go here
  });
  ```

- [ ] **Step 2: Write failing tests for `readSubagentNames()`**

  Add to the describe block:

  ```typescript
  it("returns only mode:subagent agents when some exist", () => {
    const config = JSON.stringify({
      agent: {
        build: { mode: "primary", model: "openai/gpt-5" },
        codemachine: { mode: "subagent", model: "kimi/kimi-k2" },
        review: { mode: "subagent", model: "google/gemini" },
      },
    });
    expect(readSubagentNames({ configJson: config })).toEqual(["codemachine", "review"]);
  });

  it("returns all agents when none have mode:subagent", () => {
    const config = JSON.stringify({
      agent: {
        build: { mode: "primary", model: "openai/gpt-5" },
        plan: { mode: "primary", model: "zai/glm" },
      },
    });
    expect(readSubagentNames({ configJson: config })).toEqual(["build", "plan"]);
  });

  it("returns general-purpose when agent section is empty object", () => {
    const config = JSON.stringify({ agent: {} });
    expect(readSubagentNames({ configJson: config })).toEqual(["general-purpose"]);
  });

  it("returns general-purpose when agent section is absent", () => {
    const config = JSON.stringify({ mcp: {} });
    expect(readSubagentNames({ configJson: config })).toEqual(["general-purpose"]);
  });

  it("returns general-purpose when config file is unreadable", () => {
    expect(readSubagentNames({ configJson: undefined, existsSync: () => false })).toEqual(["general-purpose"]);
  });

  it("returns general-purpose when config is malformed JSON", () => {
    expect(readSubagentNames({ configJson: "{ bad json" })).toEqual(["general-purpose"]);
  });
  ```

  Note: `readSubagentNames` accepts the same `deps` injection pattern as `readMcpConfigs` — see step 3 for the implementation.

- [ ] **Step 3: Run tests — verify they fail**

  ```bash
  bun test tests/unit/mcp-config.test.ts 2>&1 | grep -E "FAIL|error|not found"
  ```

  Expected: FAILs (function doesn't exist yet).

- [ ] **Step 4: Implement `readSubagentNames()` in `src/mcp/config.ts`**

  Add after the existing `readMcpConfigs` function. The `deps` parameter follows the same injectable pattern. Note: `"general-purpose"` is a real built-in OpenCode agent type (always valid) — the fallback is intentional, not a sentinel. The guidance injection will therefore always fire, which is the correct behaviour.

  ```typescript
  interface ReadSubagentNamesDeps {
    configJson?: string;
    existsSync?: (path: string) => boolean;
    readFileSync?: (path: string, enc: BufferEncoding) => string;
    env?: NodeJS.ProcessEnv;
  }

  export function readSubagentNames(deps: ReadSubagentNamesDeps = {}): string[] {
    let raw: string;

    if (deps.configJson != null) {
      raw = deps.configJson;
    } else {
      const exists = deps.existsSync ?? nodeExistsSync;
      const readFile = deps.readFileSync ?? nodeReadFileSync;
      const configPath = resolveOpenCodeConfigPath(deps.env ?? process.env);
      if (!exists(configPath)) return ["general-purpose"];
      try {
        raw = readFile(configPath, "utf8");
      } catch {
        return ["general-purpose"];
      }
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return ["general-purpose"];
    }

    const agentSection = parsed.agent;
    if (!agentSection || typeof agentSection !== "object" || Array.isArray(agentSection)) {
      return ["general-purpose"];
    }

    const agents = agentSection as Record<string, unknown>;
    const names = Object.keys(agents);
    if (names.length === 0) return ["general-purpose"];

    const subagentNames = names.filter((name) => {
      const entry = agents[name];
      return entry && typeof entry === "object" && !Array.isArray(entry)
        && (entry as Record<string, unknown>).mode === "subagent";
    });

    return subagentNames.length > 0 ? subagentNames : names;
  }
  ```

- [ ] **Step 5: Run tests — verify they pass**

  ```bash
  bun test tests/unit/mcp-config.test.ts 2>&1 | tail -15
  ```

  Expected: all 6 tests PASS.

- [ ] **Step 6: Run full suite — verify no regressions**

  ```bash
  bun test 2>&1 | tail -10
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add src/mcp/config.ts tests/unit/mcp-config.test.ts
  git commit -m "feat(config): add readSubagentNames() to read valid task subagent_type values"
  ```

---

### Task 3: Inject `subagentNames` into system messages

**Files:**
- Modify: `src/plugin.ts:90-95` (`buildAvailableToolsSystemMessage` signature)
- Modify: `src/plugin.ts:2059-2064` (hook call site)
- Modify: `src/proxy/prompt-builder.ts:39` (`buildPromptFromMessages` signature + tool guidance)
- Modify: `src/plugin.ts:631,1095` (`buildPromptFromMessages` call sites)
- Test: `tests/unit/proxy-prompt-builder.test.ts` (create if absent)

- [ ] **Step 1: Write failing tests for system message injection**

  Create (or extend) `tests/unit/proxy-prompt-builder.test.ts`:

  ```typescript
  import { describe, it, expect } from "bun:test";
  import { buildPromptFromMessages } from "../../src/proxy/prompt-builder.js";

  describe("buildPromptFromMessages — subagent_type injection", () => {
    const taskTool = { function: { name: "task", description: "spawn a subagent", parameters: {} } };
    const otherTool = { function: { name: "read", description: "read a file", parameters: {} } };

    it("injects guidance when tools include task and subagentNames provided", () => {
      const prompt = buildPromptFromMessages(
        [{ role: "user", content: "analyze this repo" }],
        [taskTool],
        ["general-purpose", "codemachine"],
      );
      expect(prompt).toContain("general-purpose");
      expect(prompt).toContain("codemachine");
      expect(prompt).toContain("subagent_type");
    });

    it("does not inject guidance when tools do not include task", () => {
      const prompt = buildPromptFromMessages(
        [{ role: "user", content: "read a file" }],
        [otherTool],
        ["general-purpose"],
      );
      expect(prompt).not.toContain("subagent_type");
    });

    it("does not inject guidance when subagentNames is empty", () => {
      const prompt = buildPromptFromMessages(
        [{ role: "user", content: "analyze" }],
        [taskTool],
        [],
      );
      expect(prompt).not.toContain("subagent_type");
    });

    it("works without third parameter (backwards compat)", () => {
      expect(() => buildPromptFromMessages(
        [{ role: "user", content: "hello" }],
        [otherTool],
      )).not.toThrow();
    });
  });
  ```

  Also write tests for `buildAvailableToolsSystemMessage`:

  Find the existing test file for plugin/system message, or add to a new `tests/unit/plugin-system-message.test.ts`:

  ```typescript
  import { describe, it, expect } from "bun:test";
  import { buildAvailableToolsSystemMessage } from "../../src/plugin.js";

  describe("buildAvailableToolsSystemMessage — subagentNames injection", () => {
    it("includes subagent names in task guidance", () => {
      const msg = buildAvailableToolsSystemMessage(
        ["task", "read"],
        [{ id: "task", name: "task" }],
        [],
        [],
        ["codemachine", "review"],
      );
      expect(msg).toContain("codemachine");
      expect(msg).toContain("review");
      expect(msg).toContain("subagent_type");
    });

    it("omits task guidance when subagentNames is empty", () => {
      const msg = buildAvailableToolsSystemMessage(
        ["task"],
        [],
        [],
        [],
        [],
      );
      expect(msg).not.toContain("subagent_type");
    });

    it("returns null when no tools and no subagentNames", () => {
      const msg = buildAvailableToolsSystemMessage([], [], [], [], []);
      expect(msg).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run tests — verify they fail**

  ```bash
  bun test tests/unit/proxy-prompt-builder.test.ts 2>&1 | grep -E "FAIL|error"
  ```

  Expected: FAILs (signature mismatch).

- [ ] **Step 3: Update `buildPromptFromMessages` signature and add injection**

  In `src/proxy/prompt-builder.ts`, add `subagentNames` as an **optional** third parameter with default `[]`. This is backward compatible — all existing 2-arg callers continue to work unchanged.

  ```typescript
  export function buildPromptFromMessages(
    messages: Array<any>,
    tools: Array<any>,
    subagentNames: string[] = [],   // optional, default [] for backward compat
  ): string {
  ```

  After the existing tool guidance block (currently ends around line 101 with the `lines.push(...)` call), add the injection inside the `if (tools.length > 0)` block:

  ```typescript
  // Inject task subagent_type guidance if task tool is present
  const hasTaskTool = tools.some((t: any) => {
    const name = (t?.function?.name ?? t?.name ?? "").toLowerCase();
    return name === "task";
  });
  if (hasTaskTool && subagentNames.length > 0) {
    lines.push(
      `When calling the task tool, set subagent_type to one of: ${subagentNames.join(", ")}. Do not omit this parameter.`
    );
  }
  ```

- [ ] **Step 4: Update `buildAvailableToolsSystemMessage` signature and add injection**

  In `src/plugin.ts`, add `subagentNames` as the **5th parameter** (after `mcpToolSummaries?`). This keeps the existing call site at line 2061 working without changes until Step 5 updates it.

  ```typescript
  export function buildAvailableToolsSystemMessage(
    lastToolNames: string[],
    lastToolMap: Array<{ id: string; name: string }>,
    mcpToolDefs: any[],
    mcpToolSummaries?: McpToolSummary[],
    subagentNames: string[] = [],   // 5th param, optional
  ): string | null {
  ```

  At the end of the function, before the final `return` statement (the one that checks `if (parts.length === 0) return null`):

  ```typescript
  if (subagentNames.length > 0) {
    parts.push(
      `When calling the task tool, set subagent_type to one of: ${subagentNames.join(", ")}. Do not omit this parameter.`
    );
  }
  ```

- [ ] **Step 5: Update the hook call site in `src/plugin.ts`**

  At line ~2059, update the hook:

  ```typescript
  async "experimental.chat.system.transform"(input: any, output: { system: string[] }) {
    if (!toolsEnabled) return;
    const subagentNames = readSubagentNames();
    const systemMessage = buildAvailableToolsSystemMessage(
      lastToolNames, lastToolMap, mcpToolDefs, mcpToolSummaries,
      subagentNames,
    );
    if (!systemMessage) return;
    output.system = output.system || [];
    output.system.push(systemMessage);
  },
  ```

  Add the import for `readSubagentNames` at the top of `src/plugin.ts` (near the other `src/mcp/config.ts` import):

  ```typescript
  import { readMcpConfigs, readSubagentNames } from "./mcp/config.js";
  ```

- [ ] **Step 6: Update `buildPromptFromMessages` call sites in `src/plugin.ts`**

  There are two call sites (lines ~631 and ~1095). Update both to pass `subagentNames`:

  ```typescript
  // Near line 631:
  const subagentNames = readSubagentNames();
  const prompt = buildPromptFromMessages(messages, tools, subagentNames);

  // Near line 1095 (second call site, same pattern):
  const subagentNames = readSubagentNames();
  const prompt = buildPromptFromMessages(messages, tools, subagentNames);
  ```

  Check whether `readSubagentNames` is already imported by step 5 — don't double-import.

- [ ] **Step 7: Run injection tests — verify they pass**

  ```bash
  bun test tests/unit/proxy-prompt-builder.test.ts tests/unit/plugin-system-message.test.ts 2>&1 | tail -15
  ```

  Expected: all PASS.

- [ ] **Step 8: Run full test suite**

  ```bash
  bun test 2>&1 | tail -15
  ```

  Expected: all tests pass.

- [ ] **Step 9: Commit**

  ```bash
  git add src/plugin.ts src/proxy/prompt-builder.ts tests/unit/proxy-prompt-builder.test.ts tests/unit/plugin-system-message.test.ts
  git commit -m "feat: inject valid subagent_type values into system message to fix task tool validation errors"
  ```

---

## Chunk 3: Version bump, push, and verify

### Task 4: Bump version and publish

**Files:**
- Modify: `package.json` (version bump)

- [ ] **Step 1: Run full test suite one final time**

  ```bash
  bun test 2>&1 | tail -5
  ```

  Expected: all tests pass.

- [ ] **Step 2: Bump version**

  In `package.json`, increment patch version (e.g. `2.3.19` → `2.3.20`):

  ```bash
  # Check current version first
  grep '"version"' package.json
  ```

  Edit `package.json` to bump the version.

- [ ] **Step 3: Commit and push**

  ```bash
  git add package.json
  git commit -m "chore: bump version to 2.3.20"
  git push
  ```

- [ ] **Step 4: Manual production test**

  Run in an actual OpenCode session (in a separate terminal):

  ```
  analyze this repo, tell me potential issues
  ```

  Verify:
  - No `subagent_type: undefined` errors in output
  - Model uses a valid agent name (e.g. `codemachine`, `review`, or `general-purpose`)
  - Multiple parallel `task` calls complete without guard triggering
  - Check logs if needed: `~/.config/opencode/logs/tool-loop-debug.log`

- [ ] **Step 5: Publish to npm**

  ```bash
  npm publish --access public
  ```

  (Complete OTP browser auth when prompted)

- [ ] **Step 6: Respond to GitHub issue #51**

  Update the existing comment or add a follow-up noting v2.3.20 addresses the remaining parallel-batching problem and `subagent_type` root cause.
