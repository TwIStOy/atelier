---
name: pi-self-extension
description: Guide for extending pi coding agent following official standards. Use when creating extensions (custom tools with TypeScript), skills (reusable workflows with bundled resources), or prompt templates. Ensures compliance with pi extension API, skill specification (agentskills.io), directory structure, and progressive disclosure patterns.
---

# Pi Self-Extension Guide

This skill provides authoritative guidance for extending pi in accordance with official standards. Use this when adding new capabilities to ensure architectural consistency and proper integration.

## Core Extension Mechanisms

Pi supports three primary extension mechanisms:

1. **Extensions** (`.ts` files) - Custom tools, event handlers, commands using the Extension API
2. **Skills** (SKILL.md + resources) - Domain workflows with scripts, references, and assets
3. **Prompt Templates** (`.md` files) - Reusable prompt snippets with argument expansion

## Directory Structure Standard

Official pi directory layout:

```
~/.pi/agent/                    # Global scope
├── extensions/                 # TypeScript extensions
│   ├── web-search.ts          # Single-file extension
│   └── my-extension/          # Multi-file extension
│       ├── index.ts           # Entry point (exports default function)
│       ├── package.json       # Optional: for npm dependencies
│       └── node_modules/      # After npm install
├── skills/                     # Skill packages
│   └── research/
│       ├── SKILL.md           # Required: frontmatter + instructions
│       ├── scripts/           # Executable code
│       ├── references/        # Loaded on-demand docs
│       └── assets/            # Output templates/files
├── prompts/                    # Prompt templates
│   └── review.md              # Invoked as /review
├── bin/                        # Helper binaries (optional)
│   └── fd                     # Fast file search
└── settings.json              # Pi configuration

.pi/                            # Project-local scope
├── extensions/                 # Project extensions
├── skills/                     # Project skills
├── prompts/                    # Project prompts
└── settings.json              # Project settings
```

**Auto-discovery rules:**
- Extensions: `*.ts` in root, or `*/index.ts` in subdirectories
- Skills: Direct `.md` files or recursive `SKILL.md` under subdirectories
- Prompts: `*.md` files (non-recursive)

## Decision Tree: Which Mechanism to Use

```
Need to extend pi?
│
├─ Custom tool the LLM can invoke?
│  ├─ Yes → Extension with registerTool()
│  │         Examples: web_search, database_query, image_process
│  │
│  └─ No → Continue
│
├─ Domain-specific workflow with reusable resources?
│  ├─ Yes → Skill
│  │         Examples: pdf-processing, brand-guidelines, big-query
│  │
│  └─ No → Continue
│
└─ Reusable prompt snippet?
   └─ Yes → Prompt Template
             Examples: /review, /component, /test
```

## Extension Development (TypeScript)

### When to Use Extensions

- Register custom tools callable by LLM
- Intercept events (tool calls, session lifecycle)
- Add commands (`/mycommand`)
- Modify system prompt or context
- Custom UI components
- State management across turns

### Mandatory Extension Structure

**Important:** The entry file must always accept `ExtensionAPI` as a parameter, even as a placeholder. An empty signature (`export default function (): void {}`) causes pi to fail on startup.

Location: `~/.pi/agent/extensions/web-search.ts`

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  // Register tools
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search web via Bing RSS and fetch content",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(Type.Number({ default: 5 })),
      fetchContent: Type.Optional(Type.Number()),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // Implementation
      const result = await pi.exec("python3", [
        "/home/ubuntu/web_search.py",
        params.query,
        "-n",
        String(params.limit ?? 5)
      ], { signal });
      
      // NOTE: 'details' is REQUIRED in every tool result, even if empty
      return {
        content: [{ type: "text", text: result.stdout }],
        details: { query: params.query }
      };
    }
  });

  // Register commands
  pi.registerCommand("search", {
    description: "Quick web search",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Searching: ${args}`, "info");
    }
  });

  // Event handlers
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded", "info");
  });
}
```

### Extension API Checklist

- ✅ Export default function accepting `ExtensionAPI`
- ✅ Entry function always has `ExtensionAPI` parameter (never empty)
- ✅ Use `pi.registerTool()` for LLM-callable tools
- ✅ Use `pi.registerCommand()` for `/slash` commands
- ✅ Use `pi.on()` for event interception
- ✅ Return proper result shapes with `content` and `details`
- ✅ Support cancellation via `signal`
- ✅ Truncate output (50KB/2000 lines max)
- ✅ Use `Type.Union`/`Type.Literal` from `"@sinclair/typebox"` for enums (StringEnum not available in @earendil-works)
- ✅ Every tool result MUST include `details` field (even `{}` or `{ error: "..." }`) — `AgentToolResult` requires it

### Output Truncation (Mandatory)

**All tools MUST truncate output** to avoid context overflow:

```typescript
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@earendil-works/pi-coding-agent";

async execute(toolCallId, params, signal, onUpdate, ctx) {
  const output = await runCommand();
  
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,  // 2000
    maxBytes: DEFAULT_MAX_BYTES,   // 50KB
  });

  let result = truncation.content;
  
  if (truncation.truncated) {
    const tempFile = "/tmp/output.txt";
    await fs.writeFile(tempFile, output);
    
    result += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
    result += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
    result += ` Full output: ${tempFile}]`;
  }

  return { content: [{ type: "text", text: result }] };
}
```

### Testing Extensions

```bash
# Test without installing
pi -e ~/.pi/agent/extensions/web-search.ts

# Install and reload
pi
/reload
```

## Provider Registration

### When to Use

- Register a custom LLM provider (OpenAI-compatible, Anthropic, etc.)
- Proxy multiple upstream providers through a single endpoint
- Add models not included in pi's built-in providers

### Basic Provider Registration

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("my-provider", {
    name: "My Provider",
    baseUrl: "https://api.example.com/v1",
    apiKey: "MY_API_KEY",
    api: "openai-completions",
    authHeader: true,
    models: [
      {
        id: "model-id",
        name: "Display Name",
        reasoning: true,
        input: ["text"],
        cost: { input: 1.0, output: 3.0, cacheRead: 0.2, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 128000,
        compat: {
          // Optional: override auto-detected compat
        },
      },
    ],
  });
}
```

### Model Spec Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Model identifier used in API calls |
| `name` | string | Display name |
| `reasoning` | boolean | Whether model supports thinking/reasoning |
| `input` | ("text"\|"image")[] | Input modalities |
| `cost` | object | Per-token costs: input, output, cacheRead, cacheWrite |
| `contextWindow` | number | Maximum context tokens |
| `maxTokens` | number | Maximum output tokens |
| `compat` | object | Optional compatibility overrides |

### Compat Auto-Detection Gotcha

Pi-ai's `openai-completions.js` auto-detects provider-specific compat based on `provider` name and `baseUrl`. **When using a proxy URL that doesn't match any detection pattern, ALL models get generic OpenAI defaults which may be wrong.**

Detection matches `provider === "zai"`, `baseUrl.includes("deepseek.com")`, etc. A proxy like `inference.twistoy.cn` matches **nothing**.

**Always set `compat` explicitly for each model family when building a proxy provider:**

```typescript
// Shared compat objects per upstream family
const zaiCompat = {
  supportsDeveloperRole: false,
  thinkingFormat: "zai" as const,
  zaiToolStream: true,
};

const deepseekCompat = {
  supportsDeveloperRole: false,
  thinkingFormat: "deepseek" as const,
  requiresReasoningContentOnAssistantMessages: true,
};

const moonshotCompat = {
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens" as const,
};

const qwenCompat = {
  supportsDeveloperRole: false,
  thinkingFormat: "qwen" as const,
};
```

**Key compat fields:**

| Field | Default | Notes |
|-------|---------|-------|
| `supportsDeveloperRole` | true | DeepSeek, ZAI, Moonshot, Qwen: false |
| `thinkingFormat` | "openai" | ZAI: "zai", DeepSeek: "deepseek", Qwen: "qwen" |
| `zaiToolStream` | false | ZAI/GLM: true |
| `requiresReasoningContentOnAssistantMessages` | false | DeepSeek: true |
| `supportsReasoningEffort` | true | Moonshot: false |
| `maxTokensField` | "max_completion_tokens" | Moonshot: "max_tokens" |

### Model Specs from models.dev

Use the JSON API at `https://models.dev/api.json` to source model specs (context window, costs, reasoning support). Structure:

```typescript
type ModelsDevResponse = Record<string, {
  name: string;
  models: Record<string, {
    id: string; name: string; reasoning: boolean;
    modalities: { input: string[] };
    cost: { input?: number; output?: number; cache_read?: number; cache_write?: number };
    limit: { context: number; output: number };
  }>;
}>;
```

The `opencode-go` provider aggregates models from multiple upstreams and is a good primary source.

## Prompt Templates

### Parsing Frontmatter in Extensions

Use the built-in `parseFrontmatter` utility instead of hand-rolling regex:

```typescript
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

const { frontmatter, body } = parseFrontmatter(content);
// frontmatter: Record<string, unknown> (parsed YAML)
// body: string (content after frontmatter, trimmed)
```

Handles CRLF normalization, empty frontmatter edge cases, and uses the `yaml` package for proper YAML parsing. Exported alongside `stripFrontmatter`.

### When to Use

- Reusable prompt snippets
- Common review workflows
- Code generation patterns
- Argument-based templates

### Template Structure

Location: `~/.pi/agent/prompts/review.md`

```markdown
---
description: Review code for bugs and security
---
Review the code in $1. Focus on:
- Logic errors and edge cases
- Security vulnerabilities
- Missing error handling
- Performance issues

Context: ${@:2}
```

Usage: `/review src/app.ts "payment processing module"`

### Argument Expansion

- `$1`, `$2`, ... - Positional args
- `$@` or `$ARGUMENTS` - All args joined
- `${@:N}` - Args from Nth position
- `${@:N:L}` - L args starting at N

## Migration Guide: Current → Standard

### Migrate web-search (bash script → Extension)

Current (non-standard):
```
~/.pi/agent/bin/web-search      # Bash wrapper
~/web_search.py                 # Python script
```

Standard migration:
```typescript
// ~/.pi/agent/extensions/web-search.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search web and fetch content via Bing RSS",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(Type.Number({ default: 5 })),
      fetchContent: Type.Optional(Type.Number()),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const args = [params.query, "-n", String(params.limit ?? 5)];
      if (params.fetchContent) {
        args.push("--open", String(params.fetchContent));
      }
      
      const result = await pi.exec(
        "python3",
        ["/home/ubuntu/web_search.py", ...args],
        { signal, timeout: 30000 }
      );
      
      return {
        content: [{ type: "text", text: result.stdout }],
        details: { exitCode: result.code }
      };
    }
  });
}
```

**Benefits:**
- LLM auto-discovers tool (appears in system prompt)
- Type-safe parameters
- Proper error handling
- Hot-reloadable via `/reload`

### Migrate fd (binary → Extension or keep as-is)

**Option 1: Keep as-is** (acceptable for simple binaries)
- Already in PATH via `~/.pi/agent/bin/`
- Document in skill or system prompt

**Option 2: Wrap as extension** (better discoverability)
```typescript
pi.registerTool({
  name: "find_fast",
  label: "Fast Find",
  description: "Fast file search using fd",
  parameters: Type.Object({
    pattern: Type.String(),
    path: Type.Optional(Type.String({ default: "." })),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const result = await pi.exec(
      "~/.pi/agent/bin/fd",
      [params.pattern, params.path],
      { signal }
    );
    return { content: [{ type: "text", text: result.stdout }] };
  }
});
```

## Common Patterns

### Inter-Extension Communication (EventBus)

Use `pi.events` to emit/subscribe to custom events between extensions:

```typescript
// Emit (in any extension)
pi.events.emit("my-extension:update", data);

// Subscribe (in another extension)
const unsub = pi.events.on("my-extension:update", (data) => {
  // React to state changes
});
// unsub() to stop listening
```

This is the recommended pattern for cross-extension communication (e.g., goal extension emits `goal:update`, statusline subscribes to render).

### Cross-package typed data contracts

When package A produces structured data that package B consumes, put the event-name const + payload types in `packages/common` and re-export **both** values and types from its index:

```typescript
// packages/common/events.ts
export const ZAI_CODING_PLAN_EVENTS = {
  USAGE_UPDATE: "pi-extensions:zai-coding-plan:usage-update",
  RAW_USAGE_UPDATE: "pi-extensions:zai-coding-plan:raw-usage-update",
} as const;
// packages/common/usage.ts
export interface CodingPlanRawUsage {
  level?: string;
  windows: CodingPlanUsageWindowRaw[];
  modelTotals?: CodingPlanModelTotals;
  toolTotals?: CodingPlanToolTotals;
}
```

Producer emits a typed payload; consumer narrows `unknown`:

```typescript
import {
  ZAI_CODING_PLAN_EVENTS,
  type CodingPlanRawUsage,
} from "@htwang-contrib/common";

// Producer
pi.events.emit(ZAI_CODING_PLAN_EVENTS.RAW_USAGE_UPDATE, { usage });

// Consumer
pi.events.on(ZAI_CODING_PLAN_EVENTS.RAW_USAGE_UPDATE, (data: unknown) => {
  const usage = (data as { usage?: CodingPlanRawUsage } | undefined)?.usage;
  if (!usage) return;
  // ...
});
```

**Enriching an existing channel:** emit BOTH the legacy event and a new `RAW_*` event from one fetch (backward-compat). The consumer prefers raw, falls back to legacy — register the **raw listener first** so its guard (e.g. `lastRawUsage`) is set before the legacy listener fires (Node EventEmitter dispatches listeners in registration order).

### Hidden / Continuation Prompts

Inject messages that the LLM sees but the user does not, useful for driving agent behavior:

```typescript
pi.sendMessage(
  { customType: "my-ext:continuation", content: "...", display: false },
  { triggerTurn: true, deliverAs: "followUp" },
);
```

- `display: false` — not shown in chat
- `triggerTurn: true` — starts a new agent turn
- `deliverAs: "followUp"` — delivered as a follow-up message

### Stale Context Guards

Event handlers may fire with a stale `ctx` after session replacement/reload. Always guard:

```typescript
import { isStaleCtxError } from "@htwang-contrib/common";

pi.on("session_start", async (event, ctx) => {
  try {
    // ... use ctx ...
  } catch (e) {
    if (isStaleCtxError(e)) return;
    throw e;
  }
});
```

### Extracting Token Usage from agent_end

```typescript
import type { AssistantMessage } from "@earendil-works/pi-ai";

pi.on("agent_end", (event, ctx) => {
  for (const msg of event.messages) {
    const m = msg as unknown as AssistantMessage;
    if (m.role !== "assistant" || !m.usage) continue;
    // m.usage.input, m.usage.output, m.usage.cacheRead, m.usage.cacheWrite
    // m.usage.totalTokens, m.usage.cost.total
  }
});
```

### Atomic JSON File Writes

For crash-safe file persistence, write to a temp file then rename:

```typescript
const tmp = filePath + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
fs.renameSync(tmp, filePath);
```

### Permission Gate Extension

```typescript
// ~/.pi/agent/extensions/safety.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const cmd = event.input.command;
      
      if (cmd.includes("rm -rf") || cmd.includes("sudo")) {
        const ok = await ctx.ui.confirm(
          "Dangerous Command",
          `Allow: ${cmd}?`
        );
        if (!ok) {
          return { block: true, reason: "User rejected" };
        }
      }
    }
  });
}
```

## Validation Checklist

Before considering an extension complete:

**Extensions:**
- [ ] File in `~/.pi/agent/extensions/` or `.pi/extensions/`
- [ ] Exports default function with ExtensionAPI
- [ ] Tools use `pi.registerTool()` with proper schema
- [ ] Output truncation implemented
- [ ] Cancellation support via `signal`
- [ ] Tested with `pi -e ./extension.ts`

**Providers:**
- [ ] Models have correct `contextWindow` and `maxTokens` from models.dev
- [ ] `compat` overrides set for all non-standard model families
- [ ] `supportsDeveloperRole: false` for DeepSeek, ZAI, Moonshot, Qwen
- [ ] `thinkingFormat` matches upstream provider (not "openai" for ZAI/DeepSeek/Qwen)
- [ ] `apiKey` points to correct environment variable

**Prompt Templates:**
- [ ] File in `~/.pi/agent/prompts/`
- [ ] Frontmatter with description
- [ ] Filename = command name
- [ ] Arguments tested

**Dependencies:**
- [ ] All imported `@earendil-works/*` packages listed as explicit `devDependencies` in `package.json` (transitive deps like `pi-tui` are resolved at runtime by jiti but the LSP cannot find type declarations without them)
- [ ] TypeBox imported from `"@sinclair/typebox"` (not `"typebox"`)
- [ ] If accessing `AssistantMessage` type, add `@earendil-works/pi-ai` as devDependency
- [ ] Root `pi-tui`/`pi-ai` versions aligned with what `pi-coding-agent` bundles internally — check `node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/package.json` for the bundled version
- [ ] If using helpers from `@htwang-contrib/common`, add it as dependency (not devDependency)

## References

**This monorepo's reference docs:**
- [API Reference](references/api_reference.md) — full ExtensionAPI, events, context methods
- [Statusline & UI](references/statusline.md) — footer, widgets, editor customization
- [Tool Display Adapters](references/tool_display.md) — customizing how tools render in TUI

**Official Documentation:**
- Extensions: See [extensions.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- Prompt Templates: See [prompt-templates.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/prompt-templates.md)

**Example Collections:**
- Extensions: `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/`

## Quick Commands

```bash
# Test extension
pi -e ~/.pi/agent/extensions/my-ext.ts

# Reload extensions
pi
/reload
```
