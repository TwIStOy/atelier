# `/btw` Extension — Design Document

> Design for porting the "side question" extension into this monorepo, including shared infrastructure in `packages/common/`.

## D1. Overview

A `/btw <question>` command that asks the session's primary model a one-off side question. The answer appears in a bottom-anchored overlay panel and **never** enters the main conversation transcript.

Key properties:

- No pollution — answer lives only in the overlay, never in the agent transcript or on disk.
- No tools — the side model answers in plain text.
- Session-scoped history — prior `/btw` Q&A provides follow-up context; lost on process exit.
- Same model — reuses `ctx.model` with its existing credentials.

## D2. Architecture

```
packages/common/              ← shared infrastructure (4 new modules)
  global-state.ts
  message-text.ts
  session-cache.ts
  side-call.ts

packages/btw/                 ← the extension
  index.ts                    ← entry: registers command + hooks
  btw.ts                      ← state, threading, cross-session hint
  btw-ui.ts                   ← bottom overlay component
  prompts/
    btw-system.txt            ← system prompt
```

Data flow:

```
user types /btw <question>
  │
  ├── btw-ui.ts: show overlay (pending state)
  │
  ├── btw.ts: build messages
  │     ├── session-cache.ts: read cached conversation snapshot
  │     └── append prior /btw turns + new question
  │
  ├── side-call.ts: auth check → completeSimple → result
  │
  ├── btw-ui.ts: render answer (or error)
  │
  └── btw.ts: store turn in session history
```

Background hooks (registered at startup):

```
pi.on("message_end")      → session-cache.ts: snapshot conversation
pi.on("session_compact")  → session-cache.ts: invalidate snapshot
pi.on("session_tree")     → session-cache.ts: invalidate snapshot
```

## D3. Shared Infrastructure — `packages/common/`

Four modules extracted from patterns identified in the upstream `rpiv-mono` repo where each was duplicated 2–6 times. These are added to the existing `packages/common/` package (`@htwang-contrib/common`).

### D3.1 `global-state.ts`

Process-scoped singleton state on `globalThis`, keyed by `Symbol.for(key)`.

Survives module re-import on `/new`, `/fork`, `/resume`. Lost on process exit.

```ts
export function getGlobalState<T>(key: string, init: () => T): T;
export function clearGlobalState(key: string): boolean;
```

| Aspect       | Detail                                     |
| ------------ | ------------------------------------------ |
| Dependencies | None                                       |
| Risks        | None — pure JS, single function            |
| Used by      | `session-cache.ts` (D3.3), `btw.ts` (D4.2) |

### D3.2 `message-text.ts`

Extract plain text from Pi AI message content.

```ts
export function extractMessageText(
  content: UserMessage["content"] | AssistantMessage["content"],
): string;
export function userMessageText(msg: UserMessage): string;
export function assistantMessageText(msg: AssistantMessage): string;
```

| Aspect       | Detail                                      |
| ------------ | ------------------------------------------- |
| Dependencies | `@earendil-works/pi-ai` (type imports only) |
| Risks        | None — pure functions                       |
| Used by      | `side-call.ts` (D3.4), `btw.ts` (D4.2)      |

### D3.3 `session-cache.ts`

Per-session cache with safe invalidation for stale `ctx` proxies.

```ts
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

Key:

- `SessionCache` stores values in a `globalThis`-keyed `Map<string, V>`, keyed by `ctx.sessionManager.getSessionFile()` with `memory:<sessionId>` fallback.
- `safeInvalidate` catches the `"stale after session replacement"` error that occurs when auto-compaction races session disposal.
- `branchToMessages` filters `SessionEntry[]` to `type: "message"` entries and converts via `convertToLlm()`.

| Aspect       | Detail                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Dependencies | `@earendil-works/pi-coding-agent` (`convertToLlm`, `SessionEntry`), `@earendil-works/pi-ai` (`Message`), D3.1 (`getGlobalState`) |
| Risks        | `isStaleCtxError` matches a pi-core error message substring — fragile but stable (all 3 upstream copies use the same regex)      |
| Used by      | `btw.ts` (D4.2) for conversation snapshots                                                                                       |

### D3.4 `side-call.ts`

Standardized wrapper around `completeSimple` with auth check and result branching.

```ts
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

Logic:

1. Call `modelRegistry.getApiKeyAndHeaders(model)` → guard on `auth.ok` and `auth.apiKey`.
2. Call `completeSimple(model, { systemPrompt, messages, tools: [] }, { apiKey, headers, signal })`.
3. Branch on `stopReason`: `aborted` → return aborted result; `error` → return error with message; else extract text via `assistantMessageText`.
4. Catch thrown errors; map `controller.signal.aborted` to aborted result.
5. Error messages are prefixed with `<commandName>` (e.g. `"/btw"`).

| Aspect       | Detail                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencies | `@earendil-works/pi-ai` (`completeSimple`, types), `@earendil-works/pi-coding-agent` (`ModelRegistry`, types), D3.2 (`assistantMessageText`)              |
| Risks        | Introduces runtime dependency on `@earendil-works/pi-ai` in `common` — this is acceptable since `pi-ai` is already a transitive dep via `pi-coding-agent` |
| Used by      | `btw.ts` (D4.2)                                                                                                                                           |

### D3.5 `packages/common` Dependencies After Changes

```
packages/common/package.json
  dependencies:          (unchanged)
    "cli-table3": "^0.6.5"
  devDependencies:       (unchanged — pi-ai already transitive via pi-coding-agent)
    "@earendil-works/pi-coding-agent": "latest"
    "@types/node": "^25.9.1"
    "typescript": "^6.0.0"
```

No new runtime dependencies. `@earendil-works/pi-ai` types are accessed through the existing transitive dep.

### D3.6 Updated `packages/common/index.ts`

```ts
// ... existing exports ...
export { getGlobalState, clearGlobalState } from "./global-state.ts";
export {
  extractMessageText,
  userMessageText,
  assistantMessageText,
} from "./message-text.ts";
export {
  isStaleCtxError,
  createSessionCache,
  branchToMessages,
} from "./session-cache.ts";
export type { SessionCache } from "./session-cache.ts";
export { executeSideCall } from "./side-call.ts";
export type { SideCallResult } from "./side-call.ts";
```

## D4. The Extension — `packages/btw/`

### D4.1 `package.json`

```json
{
  "name": "@htwang-contrib/btw",
  "version": "0.1.0",
  "type": "module",
  "main": "index.ts",
  "types": "index.ts",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "dependencies": {
    "@htwang-contrib/common": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-ai": "^0.76.0",
    "@earendil-works/pi-coding-agent": "latest",
    "@earendil-works/pi-tui": "^0.76.0",
    "@types/node": "^25.9.1",
    "typescript": "^6.0.0"
  }
}
```

Follows the exact pattern of `packages/subagents/package.json` — `@htwang-contrib/common` in `dependencies`, pi SDK packages in `devDependencies`.

### D4.2 `btw.ts` — Core Logic

Responsibilities:

1. **State** — session-scoped `/btw` history (Q&A turn pairs) via `getGlobalState` from D3.1.
2. **Snapshot access** — read cached conversation via `SessionCache` from D3.3.
3. **Message threading** — assemble `[branch messages] + [btw history] + [new question]`.
4. **Cross-session hint** — append recent `/btw` question strings to system prompt.
5. **Model call** — delegate to `executeSideCall` from D3.4.
6. **Command registration** — `/btw` command with `hasUI` / empty-args / no-model guards.
7. **Lifecycle hooks** — `message_end` snapshot write, `session_compact`/`session_tree` invalidation.

State shape:

```ts
interface BtwTurn {
  userMessage: UserMessage;
  assistantMessage: AssistantMessage;
}

interface BtwState {
  histories: Map<string, BtwTurn[]>;
}
```

Keyed by session file, stored on `globalThis` via `getGlobalState("htwang-contrib-btw", ...)`.

Message threading:

```ts
function buildBtwMessages(ctx, cache, history, userMessage): Message[] {
  const branchMessages =
    cache.get(ctx) ?? branchToMessages(ctx.sessionManager.getBranch());
  const historyMessages = history.flatMap((h) => [
    h.userMessage,
    h.assistantMessage,
  ]);
  return [...branchMessages, ...historyMessages, userMessage];
}
```

Stored message objects are reused by reference across calls for prompt cache parity.

Cross-session hint — last 10 question strings across all sessions:

```ts
function getCrossSessionHint(state: BtwState): string {
  // Gather all questions from all session histories, sort by timestamp,
  // take last 10, format as numbered markdown list.
  // Returns "" if no history.
}
```

Command handler flow:

```
/btw <question>
  → guard: hasUI, non-empty args, ctx.model
  → show overlay (pending)
  → build messages
  → executeSideCall
  → setAnswer / setError on overlay controller
  → push turn to history (on success only)
```

Exports:

```ts
export function registerBtw(pi: ExtensionAPI): void;
```

Internal — not exported:

- `registerMessageEndSnapshot(pi, cache)`
- `registerInvalidationHooks(pi, cache)`
- `handleBtwCommand(pi, args, ctx)`

### D4.3 `btw-ui.ts` — Overlay Component

Responsibilities:

1. **Overlay creation** — `ctx.ui.custom()` with `{ overlay: true, overlayOptions }`.
2. **Component** — implements `Component` from `@earendil-works/pi-tui`.
3. **Rendering** — banner + history + echo + answer + footer, with scroll clipping.
4. **Input** — Esc (abort + dismiss), ↑/↓ (scroll), x (clear history).

Overlay options:

```ts
const BTW_OVERLAY_OPTIONS: OverlayOptions = {
  anchor: "bottom-center",
  width: "100%",
  maxHeight: "85%",
  margin: { left: 0, right: 0, bottom: 0 },
};
```

Component layout:

```
  banner   — "/btw <question>" on themed bg stripe, padded to width    (sticky top)
  blank
  history  — "/btw <q>" muted text, one line per prior turn
  echo     — "/btw <q>" accent prefix + muted text                     (current question)
  blank
  answer   — wrapped body, 4-col indent (pending: "…", error: red, ok: plain)
  blank
  footer   — key hints (dim)                                           (sticky bottom)
```

Scroll model:

- Build full `natural[]` array.
- `maxRows = floor(termRows × 0.85)`.
- If `natural.length > maxRows`, clip from top: `natural.slice(excess - scrollOffset, ...)`.

Key handling:

```ts
handleInput(data: string): void {
  if (matchesKey(data, Key.escape)) → controller.abort(); done();
  if (matchesKey(data, Key.up))     → scrollOffset = max(0, scrollOffset - 1);
  if (matchesKey(data, Key.down))   → scrollOffset = scrollOffset + 1;  // clamped in render
  if (data === "x")                 → clear history; scrollOffset = 0;
}
```

Public API:

```ts
export interface BtwOverlayParams {
  ctx: ExtensionCommandContext;
  question: string;
  history: BtwTurn[];
  controller: AbortController;
  onClearHistory: () => void;
}

export interface BtwOverlayResult {
  overlayPromise: Promise<void>;
  controllerReady: Promise<BtwOverlayController>;
}

export class BtwOverlayController implements Component {
  setAnswer(text: string): void;
  setError(message: string): void;
  // Component interface:
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
}

export function showBtwOverlay(params: BtwOverlayParams): BtwOverlayResult;
```

### D4.4 `prompts/btw-system.txt`

```
You are answering a quick side question while the user's main pi session
continues working.

You are given the user's primary conversation as the message context —
treat it as background. Do NOT try to "continue" the assistant's prior work
or pick up a tool call mid-flight; the side question is its own
self-contained ask.

Answer directly and concisely. Prefer compact bullets or short paragraphs.
Cite files, functions, and line numbers when grounding a claim in the
context. If the context is insufficient to answer, say so briefly instead
of guessing.

You have NO tools available. You will NOT call tools, even if the prior
assistant turns demonstrate tool use. Reply in plain text only.

When a "Recent /btw questions across sessions" appendix is present below,
treat it as a high-level pattern hint about what the user has been thinking
about lately — useful only when the side question explicitly asks about
patterns, trends, or recent topics.
```

### D4.5 `index.ts` — Extension Entry

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBtw } from "./btw.ts";

export default function (pi: ExtensionAPI): void {
  registerBtw(pi);
}
```

Single registration function. All lifecycle hooks are wired inside `registerBtw`.

### D4.6 `tsconfig.json`

Identical to all sibling packages:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "composite": true,
    "emitDeclarationOnly": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["./**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

## D5. Integration Points

### D5.1 Root `package.json`

Add `"packages/btw"` to `pi.extensions` array.

### D5.2 Root `tsconfig.json`

Add `{ "path": "packages/btw" }` to `references` array.

### D5.3 `packages/common` `tsconfig.json`

No changes needed — `./**/*.ts` already picks up new modules.

## D6. Testing Strategy

Tests use Vitest with the same patterns as existing tests (`describe`/`test`, no comments, `.ts` imports).

### D6.1 `packages/common/global-state.test.ts`

- Returns init value on first access.
- Returns same reference on subsequent access.
- `clearGlobalState` removes the slot.

### D6.2 `packages/common/message-text.test.ts`

- `extractMessageText` with string content, array content with text parts, array with mixed parts.
- `userMessageText` with string and array content.
- `assistantMessageText` with text + toolCall parts (skips tool calls).

### D6.3 `packages/common/session-cache.test.ts`

- `branchToMessages` filters to message entries and converts.
- `createSessionCache` get/set/invalidate round-trip.
- `safeInvalidate` swallows stale-ctx errors, re-throws others.
- `isStaleCtxError` matches the expected substring.

### D6.4 `packages/common/side-call.test.ts`

- Mock `completeSimple`.
- Returns ok result with answer text.
- Returns error when no model auth.
- Returns aborted when stopReason is "aborted".
- Returns error when response has no text.
- Catches thrown errors and maps to result.

### D6.5 `packages/btw/btw.test.ts`

- Command registration wires `/btw`.
- `buildBtwMessages` assembles branch + history + new question in order.
- Cross-session hint is empty when no history, non-empty after turns.
- `clearSessionHistory` resets the session's history array.

### D6.6 `packages/btw/btw-ui.test.ts`

- Initial render shows banner, echo, pending glyph, dismiss footer.
- `setAnswer` replaces pending with answer text.
- `setError` renders error text.
- Esc aborts controller and calls `done()`.
- `x` clears history and invokes callback.
- Scroll clipping returns `maxRows` lines when content overflows.
- Banner is padded to full visible width.

## D7. Execution Order

Implementation follows a strict dependency chain:

```
D3.1 global-state ─────┐
                        ├── D3.3 session-cache ──┐
D3.2 message-text ──────┤                        ├── D4 btw extension
                        └── D3.4 side-call ──────┘
```

Each module must typecheck and pass tests before the next begins. See `EXECUTION-STEPS.md` for the step-by-step checklist.

## D8. Risks and Mitigations

| Risk                                   | Impact                                                                    | Mitigation                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `isStaleCtxError` regex is fragile     | Snapshot invalidation fails silently if pi-core changes the error message | The regex matches a stable substring used across all 3 upstream copies; monitor on pi-core upgrades |
| `completeSimple` API changes           | `side-call.ts` breaks                                                     | `pi-ai` is a peer dep pinned to `^0.76.0`; test with mock to catch signature drift                  |
| Overlay mode not tested in our project | TUI behavior may differ from upstream                                     | `btw-ui.test.ts` tests render output as string arrays; integration test by running `/btw` manually  |
| `convertToLlm` internal API            | May not be exported for extension use                                     | Already used by upstream `rpiv-btw` as an import from `pi-coding-agent`; confirmed available        |
| No disk persistence by design          | Users may expect history to survive restart                               | Document clearly in README; could be a future enhancement                                           |
