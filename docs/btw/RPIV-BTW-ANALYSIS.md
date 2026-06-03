# rpiv-btw Extension Analysis & Integration Plan

> Analysis of [@juicesharp/rpiv-btw](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-btw) — a "side question" Pi extension — and how its ideas map to this monorepo.

## 1. What rpiv-btw Does

`/btw <question>` lets a user ask a **one-off side question** to the same primary model without polluting the main conversation. The answer appears in a **bottom-of-terminal overlay panel** that can be scrolled and dismissed. Key properties:

| Property                   | Detail                                                                           |
| -------------------------- | -------------------------------------------------------------------------------- |
| **No pollution**           | The side answer never enters the main agent's transcript or disk                 |
| **No tools**               | The model answers in plain text only — no tool calls                             |
| **Session-scoped history** | Prior `/btw` Q&A in the same session provides follow-up context; lost on Pi exit |
| **Same model**             | Reuses the session's primary model (`ctx.model`) with its existing credentials   |
| **Conversation snapshot**  | Clones the main conversation as background context for the side question         |

## 2. Architecture Breakdown

### 2.1 File Structure

```
rpiv-btw/
├── index.ts              — entry; registers command + 2 lifecycle hooks
├── btw.ts                — state, threading, model call (~330 lines)
├── btw-ui.ts             — bottom overlay renderer (~230 lines)
├── btw.test.ts           — core logic tests
├── btw-ui.test.ts        — UI component tests
├── btw.command.test.ts   — command handler integration tests
├── ship-manifest.test.ts — package.json files coverage test
└── prompts/
    └── btw-system.txt    — system prompt (no tools, answer concisely)
```

### 2.2 Core Mechanisms

#### State: `globalThis[Symbol.for("rpiv-btw")]`

All state is stored on `globalThis` via a well-known Symbol. This survives module re-import on `/new`, `/fork`, `/resume`, `/reload` but is lost on process exit (intentional — no disk persistence).

Two maps keyed by `sessionFile` (with `memory:<sessionId>` fallback for in-memory sessions):

```ts
interface BtwState {
  histories: Map<string, BtwTurn[]>; // per-session /btw Q&A pairs
  snapshots: Map<string, { messages }>; // cached conversation snapshots
}
```

**Why `globalThis` + `Symbol.for()`?** When Pi runs `/new` or `/reload`, extensions are re-imported. Module-scoped variables would be reset. `globalThis` persists across re-imports within the same process — a well-known Node.js idiom (also used by OpenTelemetry).

**This pattern is repeated verbatim in 6 places** across the rpiv-mono repo (btw, advisor, voice, i18n, workflow×2) — strong evidence it belongs in a shared library.

#### Conversation Snapshot (`message_end` hook)

The extension hooks `message_end` to snapshot the main conversation **after each completed assistant turn** (skipping `toolUse` stop reasons):

```ts
pi.on("message_end", async (event, ctx) => {
  if (msg.role !== "assistant") return;
  if (msg.stopReason === "toolUse") return;
  setSnapshot(ctx, { messages: branchToMessages(branch) });
});
```

This avoids reading the live branch on every `/btw` invocation (which could be mid-tool-use). Snapshots are invalidated on `session_compact` and `session_tree` events.

The snapshot conversion pipeline:

```
SessionEntry[] → filter(type="message") → map(.message) → convertToLlm() → Message[]
```

`convertToLlm()` is a Pi core utility that transforms agent-level messages into LLM-ready format.

#### Message Threading (`buildBtwMessages`)

When `/btw` fires, messages are assembled as:

```
[snapshot of main conversation] + [prior /btw turns] + [new user question]
```

Key detail: stored `UserMessage` / `AssistantMessage` objects are **reused by reference** across calls. This ensures the prompt prefix is byte-identical on subsequent `/btw` calls, which is important for **prompt caching** (KV cache hit on the shared prefix).

#### Model Call (`completeSimple`)

```ts
const response = await completeSimple(
  model,
  { systemPrompt, messages, tools: [] },
  { apiKey, headers, signal: controller.signal },
);
```

- Uses `completeSimple` from `@earendil-works/pi-ai` — a lightweight API that sends messages and returns a single response.
- Own `AbortController` (separate from `ctx.signal`) so Esc only cancels the side call.
- Four `StopReason` branches: `aborted`, `error`, `toolUse`/`stop`, plus a catch for thrown exceptions.

#### Cross-Session Pattern Hint

The system prompt appends the last 10 `/btw` question strings across **all** sessions as a "pattern hint":

```
## Recent /btw questions across sessions (oldest first)
1. why did we switch from sockets to SSE?
2. what does the retry middleware do?
...
```

### 2.3 UI: Bottom Overlay Panel

The overlay uses `ctx.ui.custom()` with `{ overlay: true, overlayOptions: { anchor: "bottom-center", width: "100%", maxHeight: "85%" } }`.

**Layout** (grows upward from bottom):

```
┌──────────────────────────────────────────────┐
│  /btw why did we switch from SSE?            │ ← banner (theme.bg stripe)
│                                              │
│  /btw what does retry middleware do?          │ ← history (muted)
│  /btw how does auth work?                    │
│  /btw why did we switch from SSE?            │ ← echo (accent + muted)
│                                              │
│      The switch from WebSockets to SSE...    │ ← answer (wrapped, indented)
│      ...                                     │
│                                              │
│  ↑/↓ to scroll · Esc to dismiss              │ ← footer (dim)
└──────────────────────────────────────────────┘
```

The `BtwOverlayController` implements the `Component` interface (`render`, `handleInput`, `invalidate`). The scroll model is manual top-clipping: builds a full `natural[]` array, then slices `[start .. start + maxRows]` based on `scrollOffset`.

### 2.4 System Prompt

```
You are answering a quick side question while the user's main pi session continues working.

- Treat the main conversation as background context
- Do NOT continue the assistant's prior work
- Answer directly and concisely (prefer compact bullets)
- Cite files/functions/line numbers when grounding claims
- You have NO tools — reply in plain text only
- "Recent /btw questions" appendix is a pattern hint, not strict context
```

### 2.5 Key Design Decisions

| #   | Decision                                         | Rationale                                                           |
| --- | ------------------------------------------------ | ------------------------------------------------------------------- |
| 1   | `globalThis` + `Symbol.for()` state              | Survives `/new`, `/fork`, `/reload` within same process             |
| 2   | Snapshot at `message_end` (not live read)        | Avoids reading mid-tool-use branch; cheaper than live conversion    |
| 3   | Invalidate on `session_compact` / `session_tree` | Compaction rewrites history; tree ops restructure the branch        |
| 4   | No disk persistence                              | Side questions are ephemeral by design                              |
| 5   | `completeSimple` (not agent loop)                | No tools needed; single request-response                            |
| 6   | Own `AbortController`                            | Esc cancels only the side call, not the main session                |
| 7   | Reuse message object references                  | Byte-identical prompt prefix → KV cache hits                        |
| 8   | `tools: []` explicitly                           | Prevents model from attempting tool calls                           |
| 9   | Cross-session pattern hint                       | Lightweight context augmentation without leaking full conversations |
| 10  | `safeInvalidateSnapshot` with stale-error catch  | Handles race between auto-compaction and session disposal           |

## 3. Cross-Extension Duplication Analysis

To understand what's worth extracting, I surveyed the entire `rpiv-mono` repo for repeated patterns.

### 3.1 `globalThis` Singleton State — **6 copies**

| Package                     | Key                                                 | State shape                                  |
| --------------------------- | --------------------------------------------------- | -------------------------------------------- |
| `rpiv-btw`                  | `Symbol.for("rpiv-btw")`                            | `{ histories, snapshots }`                   |
| `rpiv-advisor`              | `Symbol.for("rpiv-advisor")`                        | `{ inventorySignature?, inventoryMessage? }` |
| `rpiv-voice`                | `Symbol.for("rpiv-voice")`                          | `unknown`                                    |
| `rpiv-i18n`                 | `Symbol.for("rpiv-i18n.runtime")`                   | `{ registry, activeLocale, activeStrings }`  |
| `rpiv-workflow` (lifecycle) | `Symbol.for("@juicesharp/rpiv-workflow:lifecycle")` | `LifecycleListeners[]`                       |
| `rpiv-workflow` (built-ins) | `Symbol.for("@juicesharp/rpiv-workflow:built-ins")` | `Workflow[]`                                 |

Every copy repeats the identical boilerplate:

```ts
const KEY = Symbol.for("...");
const g = globalThis as unknown as { [k: symbol]: T | undefined };
let state = g[KEY];
if (!state) { state = /* init */; g[KEY] = state; }
return state;
```

### 3.2 `isStaleCtxError` — **3 copies**

Identical regex check repeated in btw, todo, and core:

```ts
/stale after session replacement/.test(String(e));
```

### 3.3 `completeSimple` Executor — **2 copies** (btw + advisor)

Both follow the exact same flow:

1. Auth check via `modelRegistry.getApiKeyAndHeaders()`
2. `completeSimple(model, { systemPrompt, messages, tools: [] }, { apiKey, headers, signal })`
3. 4-way stopReason branch (aborted / error / empty / text)
4. Catch block with `controller.signal.aborted` detection

The only differences: advisor uses a separate model and adds `reasoning` parameter.

### 3.4 Message Text Extraction — **3 locations**

| Package        | Pattern                                                    |
| -------------- | ---------------------------------------------------------- |
| `rpiv-btw`     | Dedicated `userMessageText()` + `assistantMessageText()`   |
| `rpiv-advisor` | Inline `.filter(...).map(...).join("\n").trim()`           |
| `rpiv-warp`    | Unified `extractMessageText()` handling both message types |

### 3.5 Error Message Factories — **2 sets** (btw + advisor)

Same 4 functions with only a prefix string different:

```ts
errMisconfigured(label, err)  →  `<prefix> model (<label>) is misconfigured: <err>`
errNoApiKey(label)            →  `<prefix> model (<label>) has no API key available.`
errCallFailed(err)            →  `<prefix> call failed: <err>`
errCallThrew(msg)             →  `<prefix> call threw: <msg>`
```

### 3.6 `branchToMessages` (filter + `convertToLlm`) — **2 locations**

btw has a standalone wrapper; advisor calls `convertToLlm` directly with extra pre-processing.

## 4. Extractable Shared Modules → `packages/common/`

Based on the duplication analysis, these are the candidates for extraction into our `packages/common/`:

### 4.1 `global-state.ts` — GlobalThis singleton helper

**Evidence**: 6 identical copies in rpiv-mono. Zero shared helpers exist in our project.

**Proposed API**:

```ts
export function getGlobalState<T>(key: string, init: () => T): T;
export function clearGlobalState(key: string): boolean;
```

**Usage before/after**:

```ts
// BEFORE (6 lines of boilerplate per extension)
const g = globalThis as unknown as { [k: symbol]: BtwState | undefined };
let state = g[BTW_STATE_KEY];
if (!state) {
  state = { histories: new Map(), snapshots: new Map() };
  g[BTW_STATE_KEY] = state;
}
return state;

// AFTER (1 line)
return getGlobalState<BtwState>("rpiv-btw", () => ({
  histories: new Map(),
  snapshots: new Map(),
}));
```

**Dependencies**: None (pure JS). Zero risk.

### 4.2 `message-text.ts` — Message content text extraction

**Evidence**: 3 locations (btw dedicated functions, advisor inline, warp unified helper). Zero equivalent in our project.

**Proposed API**:

```ts
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";

export function extractMessageText(
  content: UserMessage["content"] | AssistantMessage["content"],
): string;
export function userMessageText(msg: UserMessage): string;
export function assistantMessageText(msg: AssistantMessage): string;
```

**Dependencies**: `@earendil-works/pi-ai` (type imports only — already a transitive dep via `pi-coding-agent`).

### 4.3 `session-cache.ts` — Per-session snapshot cache with safe invalidation

**Evidence**: `isStaleCtxError` copied 3 times. `branchToMessages` copied 2 times. The "cache on event, invalidate on event, safe-wrap stale errors" pattern is a reusable recipe for any extension that reads the conversation branch.

**Proposed API**:

```ts
import type {
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";

export function isStaleCtxError(e: unknown): boolean;

export interface SessionCache<V> {
  get(ctx: ExtensionContext): V | undefined;
  set(ctx: ExtensionContext, value: V): void;
  invalidate(ctx: ExtensionContext): void;
  safeInvalidate(ctx: ExtensionContext): void;
}

export function createSessionCache<V>(stateKey: string): SessionCache<V>;

export function branchToMessages(branch: SessionEntry[]): Message[];
```

**Dependencies**: `@earendil-works/pi-coding-agent` (for `convertToLlm`, `SessionEntry`), `@earendil-works/pi-ai` (for `Message`), and `getGlobalState` from candidate 4.1.

**Why a generic cache?** Any extension making side-calls to the LLM needs a stable view of the conversation. The pattern (write on `message_end`, invalidate on `session_compact`/`session_tree`, safe-wrap stale errors) is identical regardless of what's cached.

### 4.4 `side-call.ts` — completeSimple executor wrapper

**Evidence**: 2 near-identical 40-line executor blocks in btw and advisor. Each does auth check → `completeSimple` → 4-way stopReason branch → catch. Our project has zero `completeSimple` usage today, but a `/btw` port would need it.

**Proposed API**:

```ts
import type {
  AssistantMessage,
  Message,
  Model,
  StopReason,
} from "@earendil-works/pi-ai";

export type SideCallResult =
  | {
      ok: true;
      answer: string;
      assistantMessage: AssistantMessage;
      stopReason: StopReason;
    }
  | { ok: false; error: string; stopReason?: StopReason }
  | { ok: false; aborted: true; stopReason: StopReason };

export async function executeSideCall(opts: {
  model: Model;
  modelRegistry: ModelRegistry;
  systemPrompt: string;
  messages: Message[];
  signal: AbortSignal;
  commandName: string;
}): Promise<SideCallResult>;
```

**Dependencies**: `@earendil-works/pi-ai` (for `completeSimple`, `Model`), `@earendil-works/pi-coding-agent` (for `ModelRegistry`), `message-text.ts` (for `assistantMessageText`).

**What this eliminates**: auth guard boilerplate, error message factories, stop-reason branching, catch block — all standardized into one function. The `commandName` parameter (e.g. `"/btw"`, `"Advisor"`) replaces the need for per-extension error message factory functions.

### 4.5 Summary: Extraction Priority

| Module             | Candidates                               | Duplication | Complexity                           | Priority                                                      |
| ------------------ | ---------------------------------------- | ----------- | ------------------------------------ | ------------------------------------------------------------- |
| `global-state.ts`  | 6 copies                                 | Very high   | Very low (1 function)                | **P0** — trivial to extract, immediate value                  |
| `message-text.ts`  | 3 locations                              | High        | Very low (3 functions)               | **P0** — trivial, no deps beyond types                        |
| `session-cache.ts` | 3× isStaleCtxError + 2× branchToMessages | High        | Medium (cache + invalidation)        | **P1** — depends on 4.1, useful for any side-call             |
| `side-call.ts`     | 2 near-identical executors               | Medium      | Medium (auth + LLM call + branching) | **P2** — depends on 4.2, only needed when porting btw/advisor |

## 5. What Is NOT Worth Extracting

### 5.1 Overlay Scroll/Clip Logic

The scroll model in `BtwOverlayController.render()` is ~10 lines of `natural.slice(start, start + maxRows)` with a single `scrollOffset` variable. It's too thin and too context-specific to abstract:

- btw clips from top (bottom-anchored, newest at bottom)
- todo uses a line budget with collapse
- ask-user-question uses collapsed/expanded toggle
- Our extensions use editor slot, not overlay

The text utilities (`truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi`) are already shared via `@earendil-works/pi-tui`.

### 5.2 Overlay Options / Component Layout

`OverlayOptions` is already a pi-tui type. The banner + body + footer layout is 5 lines of array construction with styling that differs per extension.

### 5.3 Cross-Session Pattern Hint

This is a btw-specific feature (append recent questions to system prompt). It could be a standalone helper if other extensions need similar "lightweight cross-session context", but today it's only used by btw.

## 6. Comparison With Our Project

### 6.1 What We Already Have

| Capability             | Our Package                               | Status                                                          |
| ---------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| In-process subagents   | `packages/subagents/`                     | WIP — supports parallel/background runs, personas               |
| `ctx.ui.custom()`      | `user-input-history`, `ask-user-question` | Editor-slot mode (no overlay)                                   |
| TUI components         | Various                                   | `Component`, `Key`, `matchesKey`, `wrapTextWithAnsi` all used   |
| `completeSimple`       | —                                         | **Not used** in any package                                     |
| Overlay mode           | —                                         | **Not used** — all `ctx.ui.custom()` calls omit overlay options |
| Conversation snapshot  | —                                         | **Not used** — no `message_end` hook anywhere                   |
| `globalThis` singleton | —                                         | **Not used** — module-scoped state or `ctx`-attached state      |
| Model resolution       | `packages/common/model-resolve.ts`        | Fuzzy model resolution — could let `/btw` use a cheaper model   |
| Bounded concurrency    | `packages/common/concurrency.ts`          | Could rate-limit `/btw` calls                                   |

### 6.2 Gap Analysis

1. **No overlay usage**: All our `ctx.ui.custom()` calls render in the editor slot. The bottom-anchored overlay pattern is unexplored.
2. **No `completeSimple`**: We don't make raw LLM calls anywhere.
3. **No conversation snapshot**: We don't cache or clone the main conversation.
4. **No `globalThis` singleton**: We don't need process-scoped cross-import state yet.

## 7. Integration Roadmap

### Phase 1: Shared Infrastructure (no extension port yet)

Extract the P0 modules into `packages/common/`:

1. **`global-state.ts`** — `getGlobalState()` + `clearGlobalState()`
2. **`message-text.ts`** — `extractMessageText()` + `userMessageText()` + `assistantMessageText()`

Export from `packages/common/index.ts`. These are dependency-free utilities useful for any future extension.

### Phase 2: Session Cache (enables btw and other side-call extensions)

3. **`session-cache.ts`** — `createSessionCache()` + `branchToMessages()` + `isStaleCtxError()`

Depends on Phase 1's `getGlobalState`. Provides the building blocks for any extension that needs a stable conversation view.

### Phase 3: Side Call Executor (enables btw/advisor ports)

4. **`side-call.ts`** — `executeSideCall()` + `SideCallResult` type

Depends on Phase 1's `message-text.ts`. Standardizes the auth-check → LLM-call → result-branching pattern.

### Phase 4: Port `rpiv-btw` (if desired)

With Phases 1–3 in place, porting `rpiv-btw` into `packages/btw/` becomes much simpler:

| Upstream File            | Port Strategy                                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `btw.ts`                 | Replace state management with `getGlobalState`, snapshot with `createSessionCache`, executor with `executeSideCall`, message text with `extractMessageText`. Core logic shrinks to: command handler + cross-session hint + message threading. |
| `btw-ui.ts`              | Keep as-is — overlay rendering is btw-specific. Uses pi-tui primitives already in our tree.                                                                                                                                                   |
| `prompts/btw-system.txt` | Keep as-is.                                                                                                                                                                                                                                   |
| `index.ts`               | Same pattern — 3 registrations.                                                                                                                                                                                                               |

**Estimated port size**: ~200 lines (down from ~560) thanks to shared infrastructure.

### Alternative: Direct Install

If porting is not needed immediately:

```bash
pi install npm:@juicesharp/rpiv-btw
```

Works out of the box. Zero development effort. But doesn't benefit from shared infrastructure or our monorepo conventions (ESM + `.ts` imports, no comments, `common` utilities).

## 8. Appendix: Existing `packages/common/` API Surface

For reference, the modules we'd be adding to:

```ts
// Current exports (packages/common/index.ts)
export { shortenPath, truncateDisplay, trimTrailingEmpty, formatTokens, ... } from "./format.ts";
export { terminalWidth, fitColWidths, makeTable, ... } from "./terminal.ts";
export { ZAI_CODING_PLAN_EVENTS } from "./events.ts";
export { resolveModel } from "./model-resolve.ts";
export type { ResolvableModel } from "./model-resolve.ts";
export { getAvailableSkillNames } from "./skills.ts";
export { mapConcurrent } from "./concurrency.ts";

// Proposed additions:
export { getGlobalState, clearGlobalState } from "./global-state.ts";
export { extractMessageText, userMessageText, assistantMessageText } from "./message-text.ts";
export { isStaleCtxError, createSessionCache, branchToMessages } from "./session-cache.ts";
export type { SessionCache } from "./session-cache.ts";
export { executeSideCall } from "./side-call.ts";
export type { SideCallResult } from "./side-call.ts";
```
