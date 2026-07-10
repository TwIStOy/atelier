# permission-system — Implementation Plan

> Companion to [RESEARCH.md](./RESEARCH.md). Read that first — it explains the
> bash correctness problem and the locked design decisions (§10).

This document lays out the build order for `@htwang-contrib/permission-system`,
v1 scope (bash + path + tool gates, per RESEARCH.md §10 D1).

## Current state (after Step 1 — red-test porting)

Step 1 landed the test scaffolding and the pure-function + bash-spine layers.
`npm run check` is clean; `npx vitest run packages/permission-system` shows
**233 passed, 2 skipped**.

### Implemented (and tested)
- `src/wildcard-matcher.ts` — OpenCode-style wildcard→regex (last-match-wins, `?`, home-expansion, trailing-` *` optional, win32 options). *28 tests.*
- `src/bash-arity.ts` — command-prefix arity table + `stripBashCommentLines`. *36 tests.*
- `src/expand-home.ts` — `~`/`$HOME` prefix expansion.
- `src/async-cache.ts` — `memoizeAsyncWithRetry` (parser init retry-on-reject).
- `src/access-intent/bash/parser.ts` — `web-tree-sitter` + `tree-sitter-bash.wasm` lazy init, memoized. *2 tests.*
- `src/access-intent/bash/node-text.ts` — shell-value extraction from arg nodes (quotes, concatenation). *20 tests.*
- `src/access-intent/bash/token-classification.ts` — path/rule/promoted classifiers + 7-case `rejectNonPathToken`. *67 tests.*
- `src/access-intent/bash/msys-bash-tokens.ts` — win32 Git Bash `/c/…` drive-mount translation. *21 tests.*
- `src/access-intent/bash/token-collection.ts` — argument extraction incl. pattern-first commands (sed/awk/grep/rg/sd). *23 tests.*
- `src/access-intent/bash/command-enumeration.ts` — the AST walk: chains, substitutions, subshells, env-prefix strip, opaque detection.
- `src/access-intent/bash/program.ts` — `BashProgram.parse()` + `.commands()` (**active**); `.externalPaths()`/`.pathRuleCandidates()` (**stubbed → Step 2**).
- `src/handlers/gates/candidate-check.ts` — `pickMostRestrictive`.
- `src/handlers/gates/bash-command.ts` — `resolveBashCommandCheck` (most-restrictive-wins, fail-closed, opaque-floor). *18 tests + 5 metamorphic.*

### Stubbed / deferred to Step 2
- `PathNormalizer` — platform-aware path resolution + cd-folding. The two `program.test.ts` describe blocks for `pathRuleCandidates`/`externalPaths` are `.skip`-ed and wait on this.
- `AccessPath` — lexical vs canonical (symlink) value object.
- `BashPathResolver` — cd-aware token resolution over the AST.

### Not yet started
- Path gate (`handlers/gates/path.ts`, `bash-path.ts`).
- External-directory gate (`handlers/gates/external-directory.ts`, `bash-external-directory.ts`).
- Tool gate (`handlers/gates/tool.ts`).
- Config loading (`config-loader.ts`, `config-schema.ts` zod, `config-paths.ts`).
- Extension wiring (`src/index.ts` — `tool_call`/`tool_result` hooks, config read, `getAgentDir`).
- Session approvals (remember-a-decision for the rest of the turn).
- UI prompt integration (`ctx.ui.confirm`).

## Progress checklist

Track v1 progress here. Legend: `[x]` done · `[ ]` todo · `[~]` in progress.
Update this when you start/finish each item. Each checkbox maps to a file or
test under "Build order" below.

### Step 1 — Test scaffolding + pure/bash-spine (DONE)

- [x] Package skeleton (`package.json`, `tsconfig.json`, `src/types.ts`)
- [x] Test fixtures (`test/helpers/gate-fixtures.ts`: `makeResolver`, `makeCheckResult`, `makeGateCheckResult`, `makePathDispatchResolver`)
- [x] `src/wildcard-matcher.ts` + `test/wildcard-matcher.test.ts` (28)
- [x] `src/bash-arity.ts` + `test/bash-arity.test.ts` (36)
- [x] `src/expand-home.ts`
- [x] `src/async-cache.ts`
- [x] `src/access-intent/bash/parser.ts` + `test/.../parser.test.ts` (2)
- [x] `src/access-intent/bash/node-text.ts` + `test/.../node-text.test.ts` (20)
- [x] `src/access-intent/bash/token-classification.ts` + `test/.../token-classification.test.ts` (67)
- [x] `src/access-intent/bash/msys-bash-tokens.ts` + `test/.../msys-bash-tokens.test.ts` (21)
- [x] `src/access-intent/bash/token-collection.ts` + `test/.../token-collection.test.ts` (23)
- [x] `src/access-intent/bash/command-enumeration.ts`
- [x] `src/access-intent/bash/program.ts` (`.commands()` active; path slices stubbed)
- [x] `src/handlers/gates/candidate-check.ts`
- [x] `src/handlers/gates/bash-command.ts` + `test/.../bash-command.test.ts` (18) + `bash-command-metamorphic.test.ts` (5)
- [x] `npm run check` clean · vitest 233 passed / 2 skipped

### Step 2 — Path-analysis layer (DONE — unblocked skipped tests)

- [x] `src/safe-system-paths.ts` (SAFE_SYSTEM_PATHS + isSafeSystemPath)
- [x] `src/canonicalize-path.ts` (symlink-resolve best-effort)
- [x] `src/path-containment.ts` (isPathWithinDirectory / isPathOutsideWorkingDirectory)
- [x] `src/access-intent/path-normalization.ts` (canonical + comparison + policy-literal + getPathPolicyValues)
- [x] `src/access-intent/access-path.ts` (AccessPath: forPath/forLiteral/forDevice, matchValues/value/boundaryValue/resolvedAlias)
- [x] `src/path-normalizer.ts` (collaborator: forBashToken MSYS-aware, interpretBashCdTarget, resolveBase/joinBase, isAbsolute, usesWindowsSeparators, isBoundaryOutsideWorkingDirectory)
- [x] `src/access-intent/bash/bash-path-resolver.ts` (cd-folding: subshell/pipeline/brace-group scoping, unknown-cd conservatism, redirect-then-pipe #454)
- [x] Wire real resolution into `program.ts`; drop `unknown`-typed PathNormalizer export
- [x] Unskip `program.test.ts` `pathRuleCandidates` + `externalPaths` blocks (~43 cases pass)
- [x] Update `bash-command-metamorphic.test.ts` to construct a real PathNormalizer
- [x] Port unit tests for the pure layers (`path-containment.test.ts`, `canonicalize-path.test.ts`, `path-normalization.test.ts`, `access-path.test.ts`) — locks each layer's contract independently

> Porting `bash-path.test.ts` and `bash-external-directory.test.ts` moved to
> Step 3 — they test the gate-descriptor functions (`describeBashPathGate`,
> `describeBashExternalDirectoryGate`), which are Step 3 work, not the path
> layer itself. Step 2's acceptance bar is the unskipped `program.test.ts`.

### Step 3 — Gate state functions (DONE — trimmed to v1 scope)

v1 scope: each gate returns `{ state: 'allow'|'ask'|'deny'; reason? } | null`
(null = gate does not apply). Nothing else — no prompt copy, no session-approval
suggestions, no audit-log context, no decision events. Those are Step 5/6
concerns and will be designed then, not inherited from upstream's
`GateDescriptor`.

- [x] `types.ts`: `GateResult` ({ state, action, trigger, reason? }), `ToolAction` (read|write|execute|delete — delete reserved), `GateTrigger` discriminated union (path|command|none), `ToolCallContext` (slim), `AccessIntent`
- [x] `path-surfaces.ts`: `actionFromTool(toolName)` helper
- [x] Gate helpers: `value-guards`, `tool-input-path`, `candidate-check`, `external-directory-policy` (pure logic, kept)
- [x] `handlers/gates/path.ts` — describePathGate → { state, reason? } | null
- [x] `handlers/gates/bash-path.ts` — describeBashPathGate (most-restrictive across tokens)
- [x] `handlers/gates/external-directory.ts` — describeExternalDirectoryGate (infra-read bypass stubbed → Step 5)
- [x] `handlers/gates/bash-external-directory.ts` — describeBashExternalDirectoryGate
- [x] `handlers/gates/tool.ts` — describeToolGate (wraps a pre-computed check)
- [x] Port + pass `bash-path.test.ts` + `bash-external-directory.test.ts` (assert state + action + trigger shape)
- [x] Deleted (out of v1 scope): `descriptor.ts`, `session-approval.ts`, `session-rules.ts`, `denial-messages.ts`, `external-directory-messages.ts`
- [x] Fixed pre-existing `findLast` tsc error in wildcard-matcher (ES2022 compat); `npx tsc --build` clean

> **Deferred to Step 5:** the pipeline (ordered gate assembly + single
> `BashProgram.parse`) and the `tool_call` handler that interprets the
> `{state, reason?}` results (ask → `ui.confirm`, deny → block with reason).
> Upstream's `GateRunner` mechanical check→log→emit→approve cycle is NOT
> being ported — Step 5 designs its own composition from the slim gate results.

### Step 4 — Config + resolver (DONE — trimmed to v1 scope)

v1 scope: load JSONC config files, validate via zod (single source), deep-merge
global→project, apply dev-friendly defaults, and a `PermissionResolver` that
compiles the merged config to a ruleset and answers the gates' `resolve(intent)`.
Trimmed from upstream: no legacy paths, no yoloMode/modal-UI/preview-limits/
infra-read-paths/frontmatter, no JSON-Schema generation script yet.

- [x] `src/config-paths.ts` — getGlobalConfigPath(agentDir) + getProjectConfigPath(cwd)
- [x] `src/config-schema.ts` — zod single source (permissionState/denyWithReason/patternValue/permissionMap/permission + unifiedConfig); FlatPermissionConfig/PatternValue/DenyWithReason types
- [x] `src/rule.ts` — Rule/Ruleset, normalizeFlatConfig (config→rules), evaluate (last-match-wins, win32 path-surface folding), evaluateMostRestrictive
- [x] `src/config-loader.ts` — stripJsonComments (JSONC), validateUnifiedConfig, mergeFlatPermissions, mergeUnifiedConfigs, DEFAULT_PERMISSION_CONFIG (dev-friendly), applyDefaults, detectPermissiveBashFallback, loadAndMergeConfigs, loadUnifiedConfig
- [x] `src/permission-resolver.ts` — PermissionResolver implements ScopedPermissionResolver (resolve tool/access-path intents; matchedPattern undefined when only synthesized fallback fires)
- [x] types.ts: FlatPermissionConfig/PatternValue/DenyWithReason re-exported from config-schema (single source)
- [x] `test/config-loader.test.ts` (35 cases: stripJsonComments, validate, merge, defaults, detectPermissiveBashFallback)
- [x] `test/permission-resolver.test.ts` (end-to-end config→decision for tool + path surfaces, project-overrides-global)

> **Deferred:** JSON-Schema generation script (`scripts/generate-schema.ts` →
> `schemas/permissions.schema.json` for editor autocomplete) — nice-to-have,
> not blocking. Step 5 loads the merged permission map directly.

### Step 5 — Extension wiring

- [x] `src/handlers/gates/tool-call-gate-pipeline.ts` (ordered gate assembly + single `BashProgram.parse`; composes the 5 gates' `{state,action,trigger,reason?}|null` results: null→skip, deny→block, ask→confirm, else proceed). Uses PermissionResolver from Step 4 + loadAndMergeConfigs(getAgentDir(), cwd). Test: `test/handlers/gates/tool-call-gate-pipeline.test.ts` (12 cases).
- [x] `src/index.ts` factory: session_start (load config), tool_call (run pipeline, ui.confirm on ask, block on deny)
- [x] Headless fail-closed: `ctx.hasUI === false` → ask resolves to deny
- [x] Register in root `package.json` `pi.extensions`
- [x] Remove `protect-secrets` from `pi.extensions` (RESEARCH.md §10 D4) — user confirmed 2026-07-10
- [x] README + `docs/permission-system/CONFIG.md` config reference
- [ ] Manual smoke test in a real pi session (deny/ask/allow)

> **Verification:** 443 tests pass / 0 skipped (19 files); `npx tsc --build
> packages/permission-system` clean; `npm run check` clean. Pipeline is unit-tested
> with a mocked resolver + mocked UI; the real-session smoke test is the last
> acceptance bar before Step 6.

### Step 6 — Post-v1 niceties

- [ ] Session approvals (remember-a-decision via `bash-arity.prefix`) + test
- [ ] Decision audit log (`permissionReviewLog`)
- [ ] Pattern suggestions in the prompt

---

## Build order

Each step is independently testable and merges cleanly. Tests gate each step.

### Step 2 — Path-analysis layer (unblock the skipped tests)

The biggest remaining chunk. Ports upstream's `path-containment.ts`,
`access-intent/path-normalization.ts`, `access-intent/access-path.ts`,
`path-normalizer.ts`, and the cd-folding half of
`access-intent/bash/bash-path-resolver.ts`.

1. **`src/path-containment.ts`** — `isPathWithinDirectory`, `isPathOutsideWorkingDirectory` (platform-parameterized posix/win32). Pure. Port + port its test.
2. **`src/access-intent/path-normalization.ts`** — `canonicalNormalizePathForComparison`, `normalizePathForComparison`, `normalizePathPolicyLiteral`. Pure.
3. **`src/access-intent/access-path.ts`** — `AccessPath` value object: `forPath`, `forLiteral`, `forDevice`, `matchValues()`, `value()`, `boundaryValue()`. Holds lexical + canonical + raw forms.
4. **`src/path-normalizer.ts`** — the collaborator class: `forPath`, `forBashToken` (MSYS-aware via `msys-bash-tokens`), `cdTarget` interpretation, `usesWindowsSeparators`. Platform + cwd baked in.
5. **`src/access-intent/bash/bash-path-resolver.ts`** — walks the AST emitting `BashPathRuleCandidate`s and external paths, folding literal `cd` into an effective working directory (the hard part: subshell/pipeline/brace-group scoping, unknown-cd conservatism — see `program.test.ts` "effective working directory projection").
6. **Wire into `program.ts`** — replace the stub `externalPaths()`/`pathRuleCandidates()` with real resolution; drop the `unknown`-typed `PathNormalizer` export; unskip the two `program.test.ts` blocks.

**Acceptance:** unskipped `program.test.ts` passes (~40 more cases: cd-folding, symlink canonicalization, win32 projection, unknown-cd conservatism). Port `bash-path.test.ts` and `bash-external-directory.test.ts` (currently not yet ported — they need this layer).

### Step 3 — The three gates

1. **`src/handlers/gates/tool.ts`** — per-tool wildcard match on `toolName` (read/write/edit/bash). Simplest gate.
2. **`src/handlers/gates/bash-command.ts`** — already done; wire into the gate runner.
3. **`src/handlers/gates/bash-path.ts`** — cross-cutting `path` surface over bash tokens (most-restrictive across tokens, redirect targets, `~/.ssh` protection). Port `bash-path.test.ts`.
4. **`src/handlers/gates/path.ts`** — same `path` surface over `read`/`write`/`edit`/`find`/`grep`/`ls` `input.path`. Port `path.test.ts`.
5. **`src/handlers/gates/external-directory.ts`** + **`bash-external-directory.ts`** — CWD-boundary guard. Port `bash-external-directory.test.ts`.
6. **`src/handlers/gates/runner.ts`** — composes the gates in most-restrictive-wins order (path → external_directory → tool → bash). Port `runner.test.ts`.

**Acceptance:** all gate tests green; the four-layer composition (RESEARCH.md §5) holds.

### Step 4 — Config

1. **`src/config-paths.ts`** — `getAgentDir()`-based global + project config resolution (RESEARCH.md §10 D3). `~/.pi/agent/extensions/permission-system/config.json` + `<cwd>/.pi/extensions/permission-system/config.json`.
2. **`src/config-schema.ts`** — zod schema (single source). Generate `schemas/permissions.schema.json` via a `scripts/generate-schema.ts`. Nested `permission` map (path/bash/external_directory/tool + per-tool).
3. **`src/config-loader.ts`** — load + deep-merge global→project→defaults. Include `detectPermissiveBashFallback` (port its test — warns when `*: allow` leaves bash ungated). Bake in the dev-friendly defaults (RESEARCH.md §10 D2): read=allow, write/edit/bash=ask, path denies for `.env`/`~/.ssh`.

**Acceptance:** `config-loader.test.ts`, `config-schema.test.ts`, `detect-permissive-bash-fallback.test.ts` ported and green.

### Step 5 — Extension wiring

1. **`src/index.ts`** — the `ExtensionAPI` factory: `session_start` (load config), `tool_call` (run the gate pipeline, `ctx.ui.confirm` on `ask`, block on `deny` with reason), `session_shutdown`.
2. Headless-mode handling: when `ctx.hasUI === false` (print/json), `ask` resolves to deny (fail-closed) — never silently allow.
3. Register in root `package.json` `pi.extensions`.
4. README + `docs/permission-system/` user-facing config reference.

**Acceptance:** manual smoke test in a real pi session (a deny rule blocks `rm`; an ask rule prompts; a read proceeds silently). `npm run check` clean.

### Step 6 (post-v1) — Session approvals & niceties

- Remember-a-decision for the rest of the turn (uses `bash-arity.prefix` to scope the remembered pattern). Port `session-approval.test.ts`.
- Decision audit log (`permissionReviewLog`).
- Pattern suggestions in the prompt.

## Risks & open items

- **cd-folding complexity (Step 2.5).** This is the single hardest remaining piece — upstream has ~15 dedicated tests for edge cases (backgrounded cd, pipeline scoping, brace-group persistence, redirect-then-pipe grouping, `cd -`). Do not shortcut it; port the tests verbatim.
- **zod is a new runtime dep.** Confirm `pi install --omit=dev` includes it (RESEARCH.md §8). The wasm deps already resolve correctly under npm workspaces (verified).
- **`tool_call` handler ordering.** RESEARCH.md §10 D4 says disable `protect-secrets`. Don't forget to remove it from root `pi.extensions` when v1 ships, or both will hook `tool_call`.
- **Windows path shapes** are tested but our targets are NixOS + macOS. Keep the win32 tests (they're cheap and prevent regressions) but don't over-invest in win32-only features.
