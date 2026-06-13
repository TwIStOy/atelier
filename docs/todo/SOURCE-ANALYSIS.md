# rpiv-todo Source Analysis & Port Mapping

Reference catalog for porting [rpiv-todo](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo) into `packages/todo`. For each upstream file: what it does, and exactly what we change. Before/after snippets are inline where the change is non-trivial.

> High-level design decisions live in [DESIGN.md](./DESIGN.md); the execution checklist is [STEPS.md](./STEPS.md).

---

## 1. Overview & Architecture

`rpiv-todo` is a pi extension giving the LLM a task-management tool, with three surfaces:

- **`todo` tool** — create / update / list / get / delete / clear.
- **`/todos` command** — groups tasks by status in a box-drawn layout.
- **Overlay widget** — live task panel rendered above the editor.
- **Persistence** — via session branch replay; tasks survive `/reload` and conversation compaction.

### Module map

```
rpiv-todo/
├── index.ts                  # Entry: registers tool/command/overlay, lifecycle hooks
├── config.ts                 # guidance config from @juicesharp/rpiv-config
├── todo.ts                   # Tool + Command registration shell (re-exports)
├── todo-overlay.ts           # Overlay widget lifecycle controller
├── tool/
│   ├── types.ts              # Types + TypeBox schema (Task, TaskStatus, TaskAction, …)
│   └── response-envelope.ts  # Pure formatter: (op, state) → LLM result envelope
├── state/
│   ├── state.ts              # TaskState interface + EMPTY_STATE
│   ├── store.ts              # Module-level state cell (get/commit/replace/__reset)
│   ├── state-reducer.ts      # Pure reducer: (state, action, params) → { state, op }
│   ├── invariants.ts         # State-transition legality checks
│   ├── task-graph.ts         # Dependency graph: cycle detection + inverse adjacency
│   ├── selectors.ts          # Pure selectors: filter/group/count/layout
│   ├── replay.ts             # Restore state from session branch
│   └── i18n-bridge.ts        # i18n bridge (optional dep @juicesharp/rpiv-i18n)
└── view/
    └── format.ts             # renderCall / renderResult / overlay formatting
```

### Data flow

```
Tool execute()
  ├─→ applyTaskMutation(getState(), action, params)   // pure reducer → { state, op }
  ├─→ commitState(result.state)                        // publish to store
  └─→ buildToolResult(action, params, state, op)       // → { content: [{type:"text",text}], details }
                                                          details = full snapshot, used by replay
```

### Replay (last-write-wins)

```
session_start / session_compact / session_tree
  └─→ replayFromBranch(ctx)
        iterate ctx.sessionManager.getBranch()
        find last toolResult with toolName === "todo"
        extract details (type-guarded) → TaskState
        └─→ replaceState(result)
```

Key design: **every `todo` tool result carries a complete `details: TaskDetails` (tasks + nextId)**, so replay only needs the last entry.

### Overlay lifecycle

```
TodoOverlay
  ├─ setUICtx(ctx)                              # bind UI ctx; reset if identity changed (handles /reload)
  ├─ update()                                   # read store → register/refresh widget
  ├─ hideCompletedTasksFromPreviousTurn()       # on agent_start: collapse completed
  ├─ resetCompletedDisplayState()               # on session_start/compact: clear hide sets
  └─ dispose()                                  # on session_shutdown
```

Render budget: max 12 lines (heading + tasks). Overflow drops completed first, then truncates pending tail, and appends a `+N more` summary + trailing spacer.

---

## 2. Core Types

### `Task`

```ts
interface Task {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string; // present-tense label shown while in_progress
  status: TaskStatus;
  blockedBy?: number[]; // dependency task IDs
  owner?: string;
  metadata?: Record<string, unknown>;
}
```

### `TaskStatus` — four-state machine

```
pending ⇄ in_progress → completed → deleted (terminal)
  └──────────────────────┘              ↑
       any status → deleted             │
                              completed → deleted
```

- `pending` ↔ `in_progress` → `completed` → `deleted`
- `completed` → `deleted` only (not back to `in_progress`)
- `deleted` is terminal
- same→same is legal (idempotent)

### `TaskState`

```ts
interface TaskState {
  tasks: Task[];
  nextId: number;
}
```

### `Op` — reducer output (tagged union)

```ts
type Op =
  | { kind: "create"; taskId: number }
  | { kind: "update"; id: number; fromStatus: TaskStatus; toStatus: TaskStatus }
  | { kind: "delete"; id: number; subject: string }
  | { kind: "list"; statusFilter?: TaskStatus; includeDeleted: boolean }
  | { kind: "get"; task: Task }
  | { kind: "clear"; count: number }
  | { kind: "error"; message: string };
```

---

## 3. Per-File Analysis & Changes

### `index.ts` — Entry Point

**Does:** dynamically imports `@juicesharp/rpiv-i18n/loader` at module init (top-level await) to register locale strings (no-op if SDK absent); registers tool + command; manages the `TodoOverlay` singleton; lifecycle hooks restore state via `replayFromBranch` on `session_start` / `session_compact` / `session_tree`, guard those last two with `isStaleCtxError`, refresh overlay on `tool_execution_end`, and collapse completed on `agent_start`.

**Changes:**

1. Remove the entire dynamic i18n import block — no i18n SDK in our monorepo.
2. Replace inline `isStaleCtxError` with `import { isStaleCtxError } from "@htwang-contrib/common"`.
3. Remove `import { I18N_NAMESPACE } from "./state/i18n-bridge.ts"`.
4. Everything else stays identical.

```ts
// After
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isStaleCtxError } from "@htwang-contrib/common";
import { replayFromBranch } from "./state/replay.ts";
import { replaceState } from "./state/store.ts";
import { registerTodosCommand, registerTodoTool, TOOL_NAME } from "./todo.ts";
import { TodoOverlay } from "./todo-overlay.ts";

export default function (pi: ExtensionAPI) {
  let todoOverlay: TodoOverlay | undefined;
  registerTodoTool(pi);
  registerTodosCommand(pi);

  pi.on("session_start", async (_event, ctx) => {
    replaceState(replayFromBranch(ctx));
    if (ctx.hasUI) {
      todoOverlay ??= new TodoOverlay();
      todoOverlay.setUICtx(ctx.ui);
      todoOverlay.resetCompletedDisplayState();
      todoOverlay.update();
    }
  });

  for (const ev of ["session_compact", "session_tree"] as const) {
    pi.on(ev, async (_event, ctx) => {
      try {
        replaceState(replayFromBranch(ctx));
      } catch (e) {
        if (!isStaleCtxError(e)) throw e;
      }
      todoOverlay?.resetCompletedDisplayState();
      todoOverlay?.update();
    });
  }

  pi.on("session_shutdown", async () => {
    todoOverlay?.dispose();
    todoOverlay = undefined;
  });
  pi.on("tool_execution_end", async (event) => {
    if (event.toolName !== TOOL_NAME || event.isError) return;
    todoOverlay?.update();
  });
  pi.on("agent_start", async () => {
    todoOverlay?.hideCompletedTasksFromPreviousTurn();
  });
}
```

### `todo.ts` — Tool + Command Registration Shell

**Does:** `registerTodoTool(pi)` loads config guidance, validates, registers the `todo` tool with a TypeBox schema, wires `execute` → reducer → store → envelope, plus `renderCall` / `renderResult`. `registerTodosCommand(pi)` registers `/todos`, grouping tasks by status in a box-drawn layout. Also carries a large backward-compat re-export block and a `reconstructTodoState(ctx)` shim.

**Changes:**

1. Remove the entire backward-compat re-export block — no legacy consumers.
2. Remove `reconstructTodoState` shim — callers use `replaceState(replayFromBranch(ctx))` directly.
3. Remove `import { formatStatusLabel, t } from "./state/i18n-bridge.ts"`.
4. Replace `t("command.requires_interactive", …)` / `t("command.no_todos", …)` / `t("command.section.*", …)` with inline English consts (`SECTION_PENDING` / `SECTION_IN_PROGRESS` / `SECTION_COMPLETED`, etc.).
5. Replace `formatStatusLabel(status)` in the `/todos` header with the raw `status` string.
6. Keep `DEFAULT_PROMPT_SNIPPET` / `DEFAULT_PROMPT_GUIDELINES` as inline consts.
7. **Remove `renderCall` / `renderResult`** — upstream registers the tool with these two renderers and imports `renderTodoCall` / `renderTodoResult` from `view/format.ts`; our version drops both. The `registerTool` object only carries `name` / `label` / `description` / `promptSnippet` / `promptGuidelines` / `parameters` / `execute`. Rendering moves out of the todo package entirely into the [tool-display adapter](#tool-display-adapter--new) (see §6). Correspondingly we only import `formatCommandTaskLine` from `./view/format.ts`.

### `config.ts` — Guidance Configuration

**Does:** thin wrapper over `@juicesharp/rpiv-config` (`configPath("rpiv-todo")`, `loadJsonConfig`, re-exports `validateGuidanceFields`).

**Changes:** rewrite entirely using `@htwang-contrib/common`'s `readConfig`; config lives at `~/.config/pi/extensions.json` under the `"todo"` key. `validateGuidanceFields` is trivial — skip it (defaults cover both fields).

```ts
// Before (rpiv)
import {
  configPath,
  loadJsonConfig,
  validateGuidanceFields,
} from "@juicesharp/rpiv-config";
const CONFIG_PATH = configPath("rpiv-todo");
export function loadConfig(): TodoConfig {
  return loadJsonConfig<TodoConfig>(CONFIG_PATH);
}

// After (ours)
import { readConfig } from "@htwang-contrib/common";
export interface GuidanceFields {
  promptSnippet?: string;
  promptGuidelines?: string[];
}
interface TodoConfig {
  guidance?: GuidanceFields;
}
export function loadConfig(): TodoConfig {
  return readConfig<TodoConfig>("todo", { defaults: {} });
}
```

### `todo-overlay.ts` — TUI Widget

**Does:** `TodoOverlay` manages a persistent aboveEditor widget via `ctx.ui.setWidget()`; smart truncation via `selectOverlayLayout`; collapses completed tasks on `agent_start`; handles `/reload` identity changes.

**Changes:**

1. Remove `import { formatStatusLabel, t } from "./state/i18n-bridge.ts"`.
2. `t("overlay.heading", OVERLAY_HEADING)` → `OVERLAY_HEADING` (`"Todos"`); `t("overlay.more", OVERLAY_MORE)` → `OVERLAY_MORE`.
3. `formatStatusLabel("completed"|"pending")` → the literal strings.
4. `WIDGET_KEY = "rpiv-todos"` — keep as-is (free; helps users migrating from rpiv-todo).
5. Everything else stays identical.

### `state/state.ts` — TaskState Type

**Does:** `TaskState = { tasks: Task[]; nextId: number }`, `EMPTY_STATE = { tasks: [], nextId: 1 }`.
**Changes:** none — pure port (adjust `Task` import to `.ts`).

### `state/store.ts` — Module-Level State Cell

**Does:** single mutable `state: TaskState`; accessors `getState` / `getTodos` / `getNextId`; `commitState` (post-reducer) / `replaceState` (lifecycle seam) / `__resetState` (test reset).
**Changes:** none — pure port.

### `state/state-reducer.ts` — Pure Reducer

**Does:** `applyTaskMutation(state, action, params): { state, op }`. Validates inline (subject required for create, id + a mutable field for update, legal transitions, blockedBy existence, cycle detection). On error returns `{ state: currentState, op: { kind: "error", message } }` — state is **not** mutated.
**Changes:** none — pure port (imports from `../tool/types.ts`).

### `state/invariants.ts` — State Machine Rules

**Does:** `VALID_TRANSITIONS` map + `isTransitionValid(from, to)` (same→same allowed).
**Changes:** none — pure port.

### `state/task-graph.ts` — Dependency Graph

**Does:** `detectCycle(taskList, taskId, newBlockedBy)` (DFS) + `deriveBlocks(taskList)` (inverse adjacency).
**Changes:** none — pure port.

### `state/selectors.ts` — Pure Selectors

**Does:** `selectVisibleTasks`, `selectTasksByStatus`, `selectTodoCounts`, `selectShowTaskIds`, `selectTaskSubjectById`, `selectOverlayLayout(state, budget)` (drop completed first, then truncate tail), `selectHasActive`.
**Changes:** none — pure port (remove the `formatStatusLabel` import if present).

### `state/replay.ts` — Branch Replay

**Does:** `isTaskDetails(value)` type guard + `replayFromBranch(ctx)` (iterate branch, find last `todo` toolResult, reconstruct state). Pure — does not mutate the store.
**Changes:** none — pure port. `ctx.sessionManager.getBranch()` API is identical in our pi version.

### `state/i18n-bridge.ts` — Localization Bridge — **DROP**

**Does:** dynamic import of `@juicesharp/rpiv-i18n`, `t(key, fallback)` with identity fallback, `formatStatusLabel(status)`, `I18N_NAMESPACE`.
**Changes:** drop entirely. Every `t(key, fallback)` call site uses `fallback` directly; every `formatStatusLabel(status)` call site uses the English label directly.

### `tool/types.ts` — Types & Schema

**Does:** `TOOL_NAME`/`TOOL_LABEL`/`COMMAND_NAME` consts; `TaskStatus`, `TaskAction`, `Task`, `TaskDetails`, `TaskMutationParams` types; `TodoParamsSchema` TypeBox schema. Uses `StringEnum` from `@earendil-works/pi-ai` and `Type` from the legacy `typebox` package.

**Changes:**

1. `import { Type, type Static } from "typebox"` → `from "@sinclair/typebox"`.
2. Replace `StringEnum([...])` with `Type.Union([Type.Literal(...)])`:
   - action: `create | update | list | get | delete | clear`
   - status: `pending | in_progress | completed | deleted`
3. Keep all `description` strings verbatim (LLM-facing prompt copy) and field names as-is.

### `tool/response-envelope.ts` — LLM Output Formatting

**Does:** `buildToolResult(action, params, state, op)` → `{ content, details }`; `formatContent(op, state)`; `formatListLine`; `formatGetLines`. The `details` field is the replay snapshot.
**Changes:** none — pure port (inline English, no i18n).

### `view/format.ts` — TUI Rendering

**Does (upstream):** `STATUS_GLYPH` / `STATUS_COLOR` / `ACTION_GLYPH` tables; `overlayStatusGlyph`, `formatOverlayTaskLine`, `formatCommandTaskLine`, `renderTodoCall`, `renderTodoResult`.

**Changes:**

1. Remove `import { formatStatusLabel } from "../state/i18n-bridge.ts"` and the `export { formatStatusLabel }` re-export.
2. Inline English status labels where `formatStatusLabel` was called (`args.status` is already an English word).
3. **Delete `renderTodoCall` / `renderTodoResult`** — tool call/result rendering is no longer the responsibility of this file (or the todo package at all). It moves to `packages/tool-display/adapters/todo.ts` (see §6).
4. **Delete the three tables** `STATUS_GLYPH` / `STATUS_COLOR` / `ACTION_GLYPH`. The overlay glyph/color logic is inlined into `overlayStatusGlyph` (and differs from the old `STATUS_GLYPH`: completed uses `✓`, deleted uses `✗`); the `ACTION_GLYPH` table is no longer needed — the tool-display adapter header uses the action name directly.

After these changes, the file exports only three functions: `overlayStatusGlyph(status, theme)`, `formatOverlayTaskLine(t, theme, showId)`, and `formatCommandTaskLine(t, glyph)` — all serving the overlay widget and the `/todos` command, none serving the tool call/result rendering.

### `locales/*` — Translation Files — **DROP**

**Does:** `en/de/es/fr/pt/pt-BR/ru/uk.json`, loaded by the i18n SDK.
**Changes:** drop entirely — no i18n.

---

## 4. Summary of Changes Needed

| File                        | Status   | Changes                                                         |
| --------------------------- | -------- | --------------------------------------------------------------- |
| `index.ts`                  | Adapt    | Remove i18n block; import `isStaleCtxError` from common         |
| `todo.ts`                   | Adapt    | Remove re-exports + i18n; inline English; rewrite config import; **drop `renderCall`/`renderResult` (→ tool-display adapter)** |
| `config.ts`                 | Rewrite  | Use `readConfig` from `@htwang-contrib/common`                  |
| `todo-overlay.ts`           | Adapt    | Remove i18n imports; inline English strings                     |
| `state/state.ts`            | Port     | No changes                                                      |
| `state/store.ts`            | Port     | No changes                                                      |
| `state/state-reducer.ts`    | Port     | No changes                                                      |
| `state/selectors.ts`        | Port     | No changes                                                      |
| `state/task-graph.ts`       | Port     | No changes                                                      |
| `state/replay.ts`           | Port     | No changes                                                      |
| `state/invariants.ts`       | Port     | No changes                                                      |
| `state/i18n-bridge.ts`      | **Drop** | No i18n in our monorepo                                         |
| `tool/types.ts`             | Adapt    | `@sinclair/typebox`; `Type.Union` instead of `StringEnum`       |
| `tool/response-envelope.ts` | Port     | No changes                                                      |
| `view/format.ts`            | Adapt    | Remove `formatStatusLabel` + i18n; **delete `renderTodoCall`/`renderTodoResult` + `STATUS_GLYPH`/`STATUS_COLOR`/`ACTION_GLYPH` (→ tool-display adapter)** |
| `tool-display/adapters/todo.ts` | **New** | New adapter: `todoAdapter` takes over tool call/result rendering |
| `locales/*`                 | **Drop** | No i18n                                                         |

---

## 5. Stale-ctx Guard

rpiv-todo implements its own detector; we reuse the shared one.

```ts
// Before (rpiv, inline)
function isStaleCtxError(e: unknown): boolean {
  return /stale after session replacement/.test(String(e));
}

// After (ours)
import { isStaleCtxError } from "@htwang-contrib/common";
```

---

## 6. `tool-display/adapters/todo.ts` — Tool Call/Result Rendering Adapter (NEW)

This module is **new** relative to upstream `rpiv-todo` — the upstream package renders tool calls/results inside itself (`renderTodoCall` / `renderTodoResult` in `view/format.ts`, wired via `renderCall` / `renderResult` on the registered tool). Our monorepo standardizes rendering through `packages/tool-display/`, so every tool (goal / memory / read / bash / todo / …) renders the same way. The todo package therefore drops its own renderers and the rendering moves here.

**File:** `packages/tool-display/adapters/todo.ts` (not in `packages/todo/`).

**Exports:**

```ts
export interface TodoArgs {
  action?: string;  // create | update | list | get | delete | clear
  subject?: string;
  id?: number;
  status?: string;
}
export const todoAdapter: ToolDisplayAdapter<TodoArgs>;
```

The adapter header uses the action name directly (no glyph symbols).

**Method behavior:**

- `formatCallHeader` — label `Todo` (bold, `toolTitle`) + action name (`accent`) + key param(s): `create`→subject; `update`→`[state] #id <subject>` (the `[state]` bracket appears only when `status` is passed, colored by status — `in_progress` warning / `completed` success / `deleted` error / else dim); `get`/`delete`→`#id <subject>`; `list`→status; `clear`→nothing. The subject for `update`/`get`/`delete` is looked up from `details.tasks` by `args.id` (it isn't part of the args), so it appears once the result lands — not during the partial/streaming phase. E.g. `Todo create 设计API`, `Todo update [in_progress] #2 写测试`. The action is the focus (accent); params are secondary (dim/muted). When the available `width` can't fit the subject on the header line, the subject wraps to continuation line(s) (wrapped to `width-4` via `wrapTextWithAnsi`) instead of being truncated — each wrapped segment stays within the continuation budget so the downstream `truncateToWidth` in `makeHeader` is a no-op on it.
- `formatCollapsedContent` — one-line summary `└ <summary>` (muted): error path `└ Error:…`; `list` gives a count `└ N tasks`; otherwise the first line of the tool output.
- `formatExpandedContent` — delegates to the shared `formatExpandedToolOutputLines(output, theme, width)`.

**Wiring / patch mechanism:**

- `packages/tool-display/registry.ts` registers it: `globalToolDisplayRegistry.register("todo", todoAdapter)`. `packages/tool-display/index.ts` re-exports `todoAdapter`.
- `packages/tool-display/index.ts` patches `ToolExecutionComponent.prototype.render`: it first looks up the registry — **if an adapter exists, use it**; otherwise, if the tool definition defines its own `renderCall` / `renderResult`, it falls back to the built-in rendering. Because todo is registered, it always takes the adapter branch — which is exactly why `todo.ts` can drop `renderCall` / `renderResult` entirely.
- The todo package has **no import** dependency on `packages/tool-display`; the render patch is transparent to the tool.

> The detailed adapter spec (method-by-method behavior, signatures, deps) lives in [MODULES.md § tool-display adapter](./MODULES.md#tool-display-adapter--new).
