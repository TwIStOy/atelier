# `/btw` Extension — Execution Steps

> Step-by-step checklist for implementing the `/btw` extension and its shared infrastructure.
> Each step references a section in [DESIGN.md](./DESIGN.md).

## Progress Legend

- [ ] Not started
- [~] In progress
- [x] Done

---

## Phase 1: Shared Infrastructure — `packages/common/`

### Step 1.1 — Create `global-state.ts`

**Design ref:** [D3.1](./DESIGN.md#d31-global-statets)

- [ ] Create `packages/common/global-state.ts` with `getGlobalState<T>(key, init)` and `clearGlobalState(key)`
- [ ] Export from `packages/common/index.ts`
- [ ] Run `npm run format`
- [ ] Verify: `npx tsc --build packages/common` passes

### Step 1.2 — Create `global-state.test.ts`

**Design ref:** [D6.1](./DESIGN.md#d61-packagescommonglobal-statetestts)

- [ ] Create `packages/common/global-state.test.ts`
- [ ] Test: returns init value on first access
- [ ] Test: returns same reference on subsequent calls
- [ ] Test: `clearGlobalState` removes the slot
- [ ] Verify: `npx vitest run packages/common/global-state.test.ts` passes

### Step 1.3 — Create `message-text.ts`

**Design ref:** [D3.2](./DESIGN.md#d32-message-textts)

- [ ] Create `packages/common/message-text.ts` with `extractMessageText`, `userMessageText`, `assistantMessageText`
- [ ] Export from `packages/common/index.ts`
- [ ] Run `npm run format`
- [ ] Verify: `npx tsc --build packages/common` passes

### Step 1.4 — Create `message-text.test.ts`

**Design ref:** [D6.2](./DESIGN.md#d62-packagescommonmessage-texttestts)

- [ ] Create `packages/common/message-text.test.ts`
- [ ] Test: `extractMessageText` with string content
- [ ] Test: `extractMessageText` with array content (text parts only)
- [ ] Test: `extractMessageText` with mixed parts (text + non-text, skips non-text)
- [ ] Test: `userMessageText` with string and array content
- [ ] Test: `assistantMessageText` skips toolCall parts
- [ ] Verify: `npx vitest run packages/common/message-text.test.ts` passes

### Step 1.5 — Create `session-cache.ts`

**Design ref:** [D3.3](./DESIGN.md#d33-session-cachets)

Depends on: Step 1.1 (`getGlobalState`)

- [ ] Create `packages/common/session-cache.ts` with `isStaleCtxError`, `createSessionCache<V>`, `branchToMessages`
- [ ] Export `SessionCache` type and all functions from `packages/common/index.ts`
- [ ] Run `npm run format`
- [ ] Verify: `npx tsc --build packages/common` passes

### Step 1.6 — Create `session-cache.test.ts`

**Design ref:** [D6.3](./DESIGN.md#d63-packagescommonsession-cachetestts)

- [ ] Create `packages/common/session-cache.test.ts`
- [ ] Test: `branchToMessages` filters to message entries and converts
- [ ] Test: `createSessionCache` get returns undefined before set
- [ ] Test: `createSessionCache` set/get round-trip
- [ ] Test: `invalidate` removes the cached value
- [ ] Test: `safeInvalidate` swallows stale-ctx error
- [ ] Test: `safeInvalidate` re-throws non-stale errors
- [ ] Test: `isStaleCtxError` matches expected substring
- [ ] Verify: `npx vitest run packages/common/session-cache.test.ts` passes

### Step 1.7 — Create `side-call.ts`

**Design ref:** [D3.4](./DESIGN.md#d34-side-callts)

Depends on: Step 1.3 (`assistantMessageText`)

- [ ] Create `packages/common/side-call.ts` with `executeSideCall` and `SideCallResult` type
- [ ] Export function and type from `packages/common/index.ts`
- [ ] Run `npm run format`
- [ ] Verify: `npx tsc --build packages/common` passes

### Step 1.8 — Create `side-call.test.ts`

**Design ref:** [D6.4](./DESIGN.md#d64-packagescommonside-calltestts)

- [ ] Create `packages/common/side-call.test.ts`
- [ ] Mock `completeSimple` from `@earendil-works/pi-ai`
- [ ] Test: returns ok with answer text on success
- [ ] Test: returns error when `getApiKeyAndHeaders` returns not ok
- [ ] Test: returns error when apiKey is empty
- [ ] Test: returns aborted when stopReason is "aborted"
- [ ] Test: returns error when stopReason is "error"
- [ ] Test: returns error when response has no text content
- [ ] Test: maps thrown error with `signal.aborted` to aborted result
- [ ] Test: wraps unknown throws as error result
- [ ] Verify: `npx vitest run packages/common/side-call.test.ts` passes

### Step 1.9 — Phase 1 gate

- [ ] Run `npx tsc --build` (full project) — must pass
- [ ] Run `npm test` — all existing + new tests pass
- [ ] Run `npm run format`
- [ ] Verify no regressions in existing extensions

---

## Phase 2: Extension Package — `packages/btw/`

### Step 2.1 — Create package scaffold

**Design ref:** [D4.1](./DESIGN.md#d41-packagejson), [D4.6](./DESIGN.md#d46-tsconfigjson), [D5.1](./DESIGN.md#d51-root-packagejson), [D5.2](./DESIGN.md#d52-root-tsconfigjson)

- [ ] Create `packages/btw/package.json` (see D4.1)
- [ ] Create `packages/btw/tsconfig.json` (see D4.6)
- [ ] Add `{ "path": "packages/btw" }` to root `tsconfig.json` references
- [ ] Add `"packages/btw"` to root `package.json` `pi.extensions` array
- [ ] Run `npm install` to link the workspace package
- [ ] Verify: `npx tsc --build packages/btw` — should fail gracefully (no source files yet)

### Step 2.2 — Create `prompts/btw-system.txt`

**Design ref:** [D4.4](./DESIGN.md#d44-promptsbtw-systemtxt)

- [ ] Create `packages/btw/prompts/btw-system.txt` with the system prompt text
- [ ] Run `npm run format`

### Step 2.3 — Create `btw-ui.ts`

**Design ref:** [D4.3](./DESIGN.md#d43-btw-uits--overlay-component)

- [ ] Create `packages/btw/btw-ui.ts`
- [ ] Implement `BtwOverlayController` class (render, handleInput, invalidate)
  - [ ] render: banner + history + echo + answer + footer layout
  - [ ] render: scroll clipping (natural → slice with maxRows)
  - [ ] handleInput: Esc abort, ↑/↓ scroll, x clear history
  - [ ] setAnswer / setError / constructor
- [ ] Implement `showBtwOverlay` factory function
- [ ] Run `npm run format`
- [ ] Verify: `npx tsc --build packages/btw` passes (may need stub `btw.ts` first)

### Step 2.4 — Create `btw.ts`

**Design ref:** [D4.2](./DESIGN.md#d42-btwts--core-logic)

Depends on: Phase 1 (all shared modules)

- [ ] Create `packages/btw/btw.ts`
- [ ] Implement `BtwState` interface and state access via `getGlobalState`
- [ ] Implement `buildBtwMessages` (branch + history + new question)
- [ ] Implement `getCrossSessionHint` (last 10 questions across sessions)
- [ ] Implement `registerMessageEndSnapshot` (write snapshot on assistant message_end)
- [ ] Implement `registerInvalidationHooks` (invalidate on session_compact / session_tree)
- [ ] Implement `handleBtwCommand` (guard → overlay → executeSideCall → render result)
- [ ] Implement `registerBtw` (wire command + hooks)
- [ ] Export `registerBtw`, `BtwTurn`, `clearSessionHistory`
- [ ] Run `npm run format`
- [ ] Verify: `npx tsc --build packages/btw` passes

### Step 2.5 — Create `index.ts`

**Design ref:** [D4.5](./DESIGN.md#d45-indexts--extension-entry)

- [ ] Create `packages/btw/index.ts` with default export function calling `registerBtw(pi)`
- [ ] Run `npm run format`
- [ ] Verify: `npx tsc --build` (full project) passes

### Step 2.6 — Create `btw.test.ts`

**Design ref:** [D6.5](./DESIGN.md#d65-packagesbtwbtwtestts)

- [ ] Create `packages/btw/btw.test.ts`
- [ ] Mock `completeSimple` and `showBtwOverlay`
- [ ] Test: `registerBtw` registers the `/btw` command
- [ ] Test: `registerBtw` registers message_end and invalidation hooks
- [ ] Test: command handler guards — no UI, empty args, no model
- [ ] Test: `buildBtwMessages` assembles branch + history + new question in correct order
- [ ] Test: cross-session hint is empty with no history
- [ ] Test: cross-session hint includes questions after turns accumulate
- [ ] Test: `clearSessionHistory` resets the session's history array
- [ ] Verify: `npx vitest run packages/btw/btw.test.ts` passes

### Step 2.7 — Create `btw-ui.test.ts`

**Design ref:** [D6.6](./DESIGN.md#d66-packagesbtwbtw-uitestts)

- [ ] Create `packages/btw/btw-ui.test.ts`
- [ ] Test: initial render shows banner, echo, pending glyph, dismiss footer
- [ ] Test: `setAnswer` replaces pending with answer text, enables scroll hint
- [ ] Test: `setError` renders error text
- [ ] Test: Esc aborts controller and calls `done()`
- [ ] Test: `x` clears history, invokes callback, removes clear hint
- [ ] Test: scroll clipping returns `maxRows` lines when content overflows
- [ ] Test: banner is padded to full visible width
- [ ] Test: long questions are truncated with ellipsis in banner
- [ ] Test: `showBtwOverlay` calls `ctx.ui.custom` with overlay options
- [ ] Test: `controllerReady` resolves with the `BtwOverlayController`
- [ ] Verify: `npx vitest run packages/btw/btw-ui.test.ts` passes

### Step 2.8 — Phase 2 gate

- [ ] Run `npx tsc --build` (full project) — must pass
- [ ] Run `npm test` — all tests pass
- [ ] Run `npm run format`
- [ ] Manual smoke test: start pi, type `/btw what is 2+2?`, verify overlay appears with answer
- [ ] Manual test: Esc closes the overlay
- [ ] Manual test: `/btw` follow-up uses prior context
- [ ] Manual test: `/new` then `/btw` still works (state survives)
- [ ] Manual test: restart pi, `/btw` history is empty (no persistence)

---

## Dependency Graph

```
Step 1.1 ──→ Step 1.5 ──→ Step 1.9 ──→ Step 2.1
Step 1.2     Step 1.6                ├─→ Step 2.2
Step 1.3 ──→ Step 1.7               ├─→ Step 2.3
Step 1.4     Step 1.8               ├─→ Step 2.4 ──→ Step 2.5
                                     └─→ Step 2.6
                                        Step 2.7
                                           │
                                        Step 2.8
```

Steps within the same column can be done in parallel. Steps with arrows must be sequential.
