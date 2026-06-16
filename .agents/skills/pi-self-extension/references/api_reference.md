# Extension API Quick Reference

## Core Imports

```typescript
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AssistantMessage } from "@earendil-works/pi-ai";
```

## ExtensionAPI Methods

| Method                              | Purpose                            | Example                                       |
| ----------------------------------- | ---------------------------------- | --------------------------------------------- |
| `pi.registerTool(def)`              | Register LLM-callable tool         | See tool definition below                     |
| `pi.registerCommand(name, opts)`    | Add slash command                  | `/mycommand` handler                          |
| `pi.registerProvider(id, config)`   | Register LLM provider              | See provider registration below               |
| `pi.registerShortcut(key, opts)`    | Keyboard shortcut                  | `ctrl+shift+p`                                |
| `pi.registerFlag(name, opts)`       | CLI flag                           | `--my-flag`                                   |
| `pi.on(event, handler)`             | Event subscription                 | Intercept tool calls                          |
| `pi.exec(cmd, args, opts)`          | Run shell command                  | Execute external tools                        |
| `pi.events`                         | EventBus for cross-extension comms | `emit(channel, data)`, `on(channel, handler)` |
| `pi.sendMessage(msg, opts)`         | Inject custom message              | Hidden prompts, continuations                 |
| `pi.sendUserMessage(content, opts)` | Send user message                  | Trigger agent response                        |
| `pi.appendEntry(type, data)`        | Persist state                      | Save extension data                           |
| `pi.setSessionName(name)`           | Name session                       | "Refactor auth"                               |
| `pi.setLabel(entryId, label)`       | Label entry                        | Bookmark turns                                |
| `pi.getActiveTools()`               | List active tools                  | `["read", "bash"]`                            |
| `pi.setActiveTools(names)`          | Enable tools                       | Switch tool set                               |
| `pi.setModel(model)`                | Change model                       | Switch LLM                                    |
| `pi.getThinkingLevel()`             | Get reasoning level                | Current setting                               |
| `pi.setThinkingLevel(level)`        | Set reasoning                      | `"high"`                                      |

## Tool Definition

```typescript
pi.registerTool({
  name: "my_tool", // Unique identifier
  label: "My Tool", // Display name
  description: "What it does", // LLM sees this
  parameters: Type.Object({
    // JSON Schema
    action: Type.Union([Type.Literal("list"), Type.Literal("add")]),
    text: Type.Optional(Type.String()),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Check cancellation
    if (signal?.aborted)
      return { content: [{ type: "text", text: "Cancelled" }], details: {} };

    // Stream progress
    onUpdate?.({ content: [{ type: "text", text: "Working..." }] });

    // Execute
    const result = await doWork(params);

    // Return — 'details' is REQUIRED even if empty
    return {
      content: [{ type: "text", text: "Done" }],
      details: { data: result },
    };
  },
});
```

> **Important:** Every tool `execute` return MUST include a `details` field. The `AgentToolResult<unknown>` type requires it. Use `{}` for empty, `{ error: "..." }` for error cases, or structured data.

## Event Handlers

### Session Events

```typescript
pi.on("session_start", async (event, ctx) => {
  // event.reason: "startup" | "reload" | "new" | "resume" | "fork"
});

pi.on("session_before_switch", async (event, ctx) => {
  // Before /new or /resume
  return { cancel: true }; // Optional: prevent switch
});

pi.on("session_switch", async (event, ctx) => {
  // After switch
});

pi.on("session_shutdown", async (event, ctx) => {
  // event.reason: "quit" | "reload" | "new" | "resume" | "fork"
});
```

### Agent Events

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // Before LLM turn
  return {
    message: { customType: "ext", content: "Context" },
    systemPrompt: event.systemPrompt + "\nExtra instructions",
  };
});

pi.on("agent_start", async (event, ctx) => {
  // event: { type: "agent_start" }
});

pi.on("agent_end", async (event, ctx) => {
  // event.messages: AgentMessage[] — all messages from this agent turn
  // Extract token usage from assistant messages:
  for (const msg of event.messages) {
    const m = msg as unknown as AssistantMessage;
    if (m.role === "assistant" && m.usage) {
      // m.usage: { input, output, cacheRead, cacheWrite, totalTokens, cost: { ... } }
    }
  }
});

pi.on("turn_start", async (event, ctx) => {
  // Each LLM turn starts
});

pi.on("turn_end", async (event, ctx) => {
  // Each LLM turn ends
});
```

### Tool Events

```typescript
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  // Before tool executes
  if (isToolCallEventType("bash", event)) {
    if (event.input.command.includes("rm -rf")) {
      return { block: true, reason: "Dangerous" };
    }
  }
});

// NOTE: a `{ block: true, reason }` return becomes the tool's RESULT, not just
// a prevention. pi-agent-core converts it to an immediate error result:
//   { content: [{ type: "text", text: reason }], details: {}, isError: true }
// So `reason` shows up as the tool's output text + red error icon in the TUI.
// The extension cannot attach a richer reason shape than a text content block.

pi.on("tool_result", async (event, ctx) => {
  // After tool executes
  // Modify result:
  return {
    content: [...],
    details: {...},
    isError: false
  };
});
```

### Input Events

```typescript
pi.on("input", async (event, ctx) => {
  // User input received
  // Transform input
  if (event.text.startsWith("?")) {
    return {
      action: "transform",
      text: "Respond briefly: " + event.text.slice(1),
    };
  }
  // Handle without LLM
  if (event.text === "ping") {
    ctx.ui.notify("pong", "info");
    return { action: "handled" };
  }
  return { action: "continue" }; // Default: pass through
});
```

## ExtensionContext (ctx)

### UI Methods

```typescript
// Dialogs
const choice = await ctx.ui.select("Title", ["A", "B", "C"]);
const ok = await ctx.ui.confirm("Title", "Message");
const text = await ctx.ui.input("Prompt", "default");
const multiline = await ctx.ui.editor("Title", "prefilled");

// Notifications
ctx.ui.notify("Message", "info"); // "info" | "warning" | "error"

// Status
ctx.ui.setStatus("my-ext", "Processing...");
ctx.ui.setStatus("my-ext", undefined); // Clear

// Widgets
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);
ctx.ui.setWidget("my-widget", undefined); // Clear

// Working message
ctx.ui.setWorkingMessage("Thinking deeply...");
ctx.ui.setWorkingMessage(); // Restore default

// Editor
ctx.ui.setEditorText("Prefill");
const current = ctx.ui.getEditorText();

// Tools expanded
ctx.ui.setToolsExpanded(true);
const expanded = ctx.ui.getToolsExpanded();

// Title
ctx.ui.setTitle("pi - my-project");
```

### Session Access

```typescript
// Read session
const entries = ctx.sessionManager.getEntries();
const branch = ctx.sessionManager.getBranch();
const leafId = ctx.sessionManager.getLeafId();

// Context usage
const usage = ctx.getContextUsage();
if (usage && usage.tokens > 100_000) {
  // Trigger compaction
}

// System prompt
const prompt = ctx.getSystemPrompt();
```

### Control Flow

```typescript
// Check state
if (ctx.isIdle()) {
  /* Agent not streaming */
}
if (ctx.hasPendingMessages()) {
  /* Messages queued */
}

// Shutdown
ctx.shutdown(); // Graceful exit

// Compaction
ctx.compact({
  customInstructions: "Focus on recent changes",
  onComplete: (result) => ctx.ui.notify("Done", "info"),
  onError: (error) => ctx.ui.notify(`Failed: ${error}`, "error"),
});
```

## ExtensionCommandContext

Command handlers get extended context with session control:

```typescript
pi.registerCommand("my-cmd", {
  handler: async (args, ctx) => {
    // Wait for idle
    await ctx.waitForIdle();

    // New session
    await ctx.newSession({
      parentSession: ctx.sessionManager.getSessionFile(),
      setup: async (sm) => {
        sm.appendMessage({...});
      }
    });

    // Fork
    await ctx.fork("entry-id");

    // Navigate tree
    await ctx.navigateTree("entry-id", {
      summarize: true,
      label: "checkpoint"
    });
  }
});
```

## Hidden Message Injection

Inject messages the LLM sees but the user doesn't (useful for continuation prompts, budget alerts, etc.):

```typescript
pi.sendMessage(
  { customType: "my-ext:action", content: "...", display: false },
  { triggerTurn: true, deliverAs: "followUp" },
);
```

| Parameter     | Values                                | Description                    |
| ------------- | ------------------------------------- | ------------------------------ |
| `display`     | `boolean`                             | `false` = hidden from chat     |
| `triggerTurn` | `boolean`                             | `true` = starts new agent turn |
| `deliverAs`   | `"steer" \| "followUp" \| "nextTurn"` | How message is delivered       |

## EventBus (Cross-Extension Communication)

```typescript
// Emit a custom event
pi.events.emit("my-ext:update", { status: "active" });

// Subscribe to a custom event (returns unsubscribe function)
const unsub = pi.events.on("my-ext:update", (data: unknown) => {
  // Handle event
});
unsub(); // Stop listening
```

## Stale Context Guard

Event handlers can fire with stale contexts after session replacement/reload:

```typescript
import { isStaleCtxError } from "@htwang-contrib/common";

try {
  ctx.ui.notify("...", "info");
} catch (e) {
  if (isStaleCtxError(e)) return; // Safely ignore
  throw e;
}
```

## Provider Registration

```typescript
pi.registerProvider("provider-id", {
  name: "Display Name",
  baseUrl: "https://api.example.com/v1",
  apiKey: "ENV_VAR_NAME", // Environment variable holding the API key
  api: "openai-completions", // API protocol
  authHeader: true, // Send key in Authorization header
  models: [
    {
      id: "model-id",
      name: "Model Display Name",
      reasoning: true,
      input: ["text"], // ["text"] or ["text", "image"]
      cost: { input: 1.0, output: 3.0, cacheRead: 0.2, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 128000,
      compat: {
        // Optional: override auto-detected compat
        supportsDeveloperRole: false,
        thinkingFormat: "zai",
      },
    },
  ],
});
```

### Compat Override Fields

| Field                                         | Type    | Default                 | Description                                                    |
| --------------------------------------------- | ------- | ----------------------- | -------------------------------------------------------------- |
| `supportsDeveloperRole`                       | boolean | true                    | Whether API accepts `developer` role messages                  |
| `thinkingFormat`                              | string  | "openai"                | Thinking parameter format: "openai", "zai", "deepseek", "qwen" |
| `zaiToolStream`                               | boolean | false                   | ZAI-specific tool streaming protocol                           |
| `requiresReasoningContentOnAssistantMessages` | boolean | false                   | Include reasoning content in assistant messages                |
| `supportsReasoningEffort`                     | boolean | true                    | Whether `reasoning_effort` parameter is supported              |
| `maxTokensField`                              | string  | "max_completion_tokens" | Field name for max output tokens                               |

## Output Truncation

```typescript
import {
  truncateHead, // Keep first N lines/bytes
  truncateTail, // Keep last N lines/bytes
  truncateLine, // Truncate single line
  formatSize, // "50KB", "1.5MB"
  DEFAULT_MAX_BYTES, // 50KB
  DEFAULT_MAX_LINES, // 2000
} from "@earendil-works/pi-coding-agent";

const output = "...";
const truncation = truncateHead(output, {
  maxLines: DEFAULT_MAX_LINES,
  maxBytes: DEFAULT_MAX_BYTES,
});

let result = truncation.content;
if (truncation.truncated) {
  result += `\n[Truncated: ${truncation.outputLines}/${truncation.totalLines} lines, `;
  result += `${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}]`;
}
```

## Type Schemas

### StringEnum replacement

`StringEnum` is NOT available in `@earendil-works/pi-ai`. Use `Type.Union`/`Type.Literal` from `"typebox"` instead:

```typescript
import { Type } from "typebox";

parameters: Type.Object({
  action: Type.Union([
    Type.Literal("list"),
    Type.Literal("add"),
    Type.Literal("delete"),
  ]),
  format: Type.Union([Type.Literal("json"), Type.Literal("yaml")]),
});
```

### Common Patterns

```typescript
// Optional with default
text: Type.Optional(Type.String({ default: "hello" }));

// Number with range
count: Type.Number({ minimum: 1, maximum: 100 });

// Array
items: Type.Array(Type.String());

// Object
config: Type.Object({
  enabled: Type.Boolean(),
  timeout: Type.Number(),
});
```

## Best Practices

1. **Always truncate output** - Use `truncateHead` or `truncateTail`
2. **Support cancellation** - Check `signal?.aborted`
3. **Stream progress** - Use `onUpdate` for long operations
4. **Validate before packaging** - Check frontmatter and structure
5. **Test with `-e` flag** - `pi -e ./extension.ts`
6. **Use `/reload`** - Hot-reload after changes
7. **Document in description** - LLM sees tool descriptions
8. **Handle errors gracefully** - Return error in `content`
9. **Store state in details** - For session reconstruction
10. **Follow naming conventions** — `snake_case` tool names, `CamelCase` labels

## Example: Complete Extension

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // State
  let searchHistory: string[] = [];

  // Restore from session
  pi.on("session_start", async (_event, ctx) => {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "toolResult") {
        if (entry.message.toolName === "web_search") {
          searchHistory = entry.message.details?.history ?? [];
        }
      }
    }
  });

  // Register tool
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search web via Bing RSS",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(
        Type.Number({ default: 5, minimum: 1, maximum: 20 }),
      ),
      format: Type.Union([Type.Literal("text"), Type.Literal("json")]),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }] };
      }

      onUpdate?.({ content: [{ type: "text", text: "Searching..." }] });

      const result = await pi.exec(
        "python3",
        [
          "/home/ubuntu/web_search.py",
          params.query,
          "-n",
          String(params.limit),
        ],
        { signal, timeout: 30000 },
      );

      if (result.code !== 0) {
        return {
          content: [{ type: "text", text: `Error: ${result.stderr}` }],
          details: { error: result.stderr },
        };
      }

      const truncation = truncateHead(result.stdout, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      let output = truncation.content;
      if (truncation.truncated) {
        output += `\n[Truncated: ${truncation.outputLines}/${truncation.totalLines} lines]`;
      }

      searchHistory.push(params.query);

      return {
        content: [{ type: "text", text: output }],
        details: { query: params.query, history: [...searchHistory] },
      };
    },
  });

  // Register command
  pi.registerCommand("history", {
    description: "Show search history",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Searches: ${searchHistory.length}`, "info");
    },
  });
}
```
