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

Location: `~/.pi/agent/extensions/web-search.ts`

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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
- ✅ Use `pi.registerTool()` for LLM-callable tools
- ✅ Use `pi.registerCommand()` for `/slash` commands
- ✅ Use `pi.on()` for event interception
- ✅ Return proper result shapes with `content` and `details`
- ✅ Support cancellation via `signal`
- ✅ Truncate output (50KB/2000 lines max)
- ✅ Use `StringEnum` from `@mariozechner/pi-ai` for enums

### Output Truncation (Mandatory)

**All tools MUST truncate output** to avoid context overflow:

```typescript
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";

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

## Prompt Templates

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
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

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

### Permission Gate Extension

```typescript
// ~/.pi/agent/extensions/safety.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

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

**Prompt Templates:**
- [ ] File in `~/.pi/agent/prompts/`
- [ ] Frontmatter with description
- [ ] Filename = command name
- [ ] Arguments tested

## References

**Official Documentation:**
- Extensions: See [extensions.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- Prompt Templates: See [prompt-templates.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/prompt-templates.md)

**Example Collections:**
- Extensions: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/`

## Quick Commands

```bash
# Test extension
pi -e ~/.pi/agent/extensions/my-ext.ts

# Reload extensions
pi
/reload
```
