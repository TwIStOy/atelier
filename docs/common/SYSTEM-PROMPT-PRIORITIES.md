# System Prompt Contribution Priorities

Shared ledger for `registerSystemPromptContribution` in `@htwang-contrib/common`.

Extensions that change the parent-session system prompt must register a callback at factory time instead of returning `{ systemPrompt }` from their own `before_agent_start` handler. The assembler runs every non-empty callback in this table's order. Default `mode` is `append` (join onto the current prompt). `mode: "replace"` swaps the current prompt for the callback's return value.

## Sort order

- **Lower `priority` is applied first** (appears earlier in the assembled appendix).
- **Higher `priority` is applied later** (closer to the end of the prompt; last word).
- Equal priorities break ties by `id` (`localeCompare`).
- Numbers are spaced by 100 so a new extension can slot between existing ones without renumbering.

The same numbers live in `SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES` in `packages/common/src/system-prompt-contributions.ts`. A documented `id` registered with any other number throws at startup. Adding an extension means updating **this file and that constant in the same change**.

## Ledger

| id | priority | Package | What it appends |
| --- | ---: | --- | --- |
| `subagents` | 100 | `packages/subagents` | Parent-session feature prompt + persona catalog XML. Skips child subagent sessions. |
| `memory` | 200 | `packages/memory` | Memory + journal instruction blocks. Skips when memory tools are disabled for the session. |
| `inject-prompt-by-model` | 300 | `packages/inject-prompt-by-model` | Cached model-specific rules for the current `provider/id`. Skips when no rule matched. |

## Callback contract

```ts
import {
  registerSystemPromptContribution,
  SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES,
} from "@htwang-contrib/common";

registerSystemPromptContribution(pi, {
  id: "my-extension",
  priority: 250,
  // mode: "append", // default
  contribute(_event, ctx) {
    if (!shouldInject(ctx)) return null;
    return "appendix text";
  },
});

registerSystemPromptContribution(pi, {
  id: "my-override",
  priority: 50,
  mode: "replace",
  contribute(event) {
    return event.systemPrompt.replace("old", "new");
  },
});
```

- `mode` is `"append"` (default) or `"replace"`.
- Return a non-empty string to apply it this turn (`append` joins with a blank line; `replace` becomes the whole current prompt).
- Return `null`, `undefined`, or whitespace-only to sit out this turn.
- `event.systemPrompt` is the prompt **so far** in this assembler pass (base + earlier contributions). A later `replace` discards earlier appends; a later `append` stacks on top of a replace.
- The callback may be async.
- Do **not** also return `{ systemPrompt }` from a `before_agent_start` handler for the same change — that would bypass the priority order.
- Re-registering the same `id` replaces the previous callback (safe across `/reload`).
