# Upstream tracking — `tintinweb/pi-subagents`

This file tracks the upstream `tintinweb/pi-subagents` repository so we can resume
diffing from a known point each session instead of re-auditing from scratch.

- **Source repo:** https://github.com/tintinweb/pi-subagents
- **Our port:** `packages/subagents/`
- **Design notes:** [`DESIGN.md`](./DESIGN.md) · step checklist: [`STEPS.md`](./STEPS.md)
- **Last upstream audit before this port:** **2026-06-01** (see `DESIGN.md` revision log)

## Commit pointers

| Role | SHA | Date (UTC+2) | Subject |
| ---- | --- | ---- | ------- |
| **Our baseline** (last audited) | `4b8f45a909492d82239553c63e8cdebcfbdf8ac9` | 2026-06-01 | `e2e tests` (parent of the first substantive June commit `e55d391`) |
| **Upstream HEAD (this audit)** | `8405e556acc8ab2c0fcfa02021f871365695f776` | 2026-06-30 | `v0.13.0` (version bump; last real change `c32beeb` inline steer composer, also 2026-06-30) |

> Next session: `git -C <cache> fetch && git log 8405e55..origin/main` to see only
> what landed since this audit. Update the HEAD row above when you re-audit.

## What changed upstream (2026-06-01 → HEAD)

Only substantive commits are listed (version bumps, README-only, and pure test
scaffolding are omitted). Grouped by theme.

### A. New agent frontmatter keys

| Commit | Key | Effect |
| --- | --- | --- |
| `d761e11` | `exclude_extensions` (`string[]`) | Per-persona extension denylist, applied after the `extensions:` include set. Exclude wins over `tools: ext:`. Curated `extension-error:` warnings when a denylisted extension is missing. Ignored when `isolated: true`. |
| `d2027ac` | `persist_session` (`boolean`) + `session_dir` (`string`) | Opt into a real Pi session instead of in-memory. `runAgent` switches between `SessionManager.create(cwd, dir)` and `SessionManager.inMemory(cwd)`. `session_dir` may be `~`, absolute, or relative. |

### B. New persisted settings keys

| Commit | Key | Default | Effect |
| --- | --- | --- | --- |
| `f5c5805` | `disableDefaultAgents` | `false` | Hide the shipped `general-purpose` / `Explore` / `Plan` personas from the catalog and the `/agents` list. |
| `d9a3c4f` | `toolDescriptionMode` (`full` \| `compact` \| `custom`) | `full` | Compact collapses the Agent tool description to one line per type. `custom` loads `.pi/agent-tool-description.md` with `{{typeList}}` / `{{compactTypeList}}` / `{{agentDir}}` / `{{scheduleGuideline}}` placeholders. |
| `5889ab0` | `fleetView` | `true` | Toggle the FleetView navigator. |
| `c32e8e0` | `widgetMode` (`all` \| `background` \| `off`) | **`background`** | Above-editor status widget no longer duplicates foreground runs by default. Behavior change. |

### C. New UX / TUI

| Commit | Feature | Notes |
| --- | --- | --- |
| `5889ab0` | **FleetView** (`src/ui/fleet-list.ts`, ~358 lines) | `belowEditor` navigable list of `main` + every running subagent. `↓`/`←` at the empty prompt enters; `↑`/`↓` selects; `Enter` opens the live conversation overlay; `Esc` returns. Finished agents linger ~4s. Width-clamped to avoid the narrow-terminal flicker. Uses `ui.onTerminalInput` + `ui.setWidget(key, factory, { placement: "belowEditor" })`. |
| `c32beeb` | **Inline steer composer** | Inside the conversation viewer, `Enter` opens a one-line `Input`; `Enter` sends via `AgentManager.steer()`, `Esc`/empty cancels. Footer split actions-left / nav-right. |
| `e55d391` | **Two-press `x` to stop** | In the viewer: first `x` arms (`x again to STOP`), second `x` calls `manager.abort(id)` + `ctx.ui.notify`. Reworded status notes (`STOPPED BY THE USER`). |
| `ceba678` | **Viewer honors `tui.select.*` keybindings** | New `src/ui/viewer-keys.ts` resolves `tui.select.up/down/pageUp/pageDown` via the injected `KeybindingsManager`, keeping `k/j` + shift-arrow aliases. |
| `6235f40` | **`/agents → Agent types` redesign** | `SettingsList`-based; full description renders below the highlighted row; model column flags `(unavailable, fallback: inherit)` and `(→ provider/id)`. |

### D. Core (`agent-manager.ts`, `agent-runner.ts`, `model-resolver.ts`)

| Commit | Change |
| --- | --- |
| `30bfed0` | `SpawnOptions.cwd` + split `RunOptions.configCwd` (config stays with the parent project; the run can target another dir). New `assertValidSpawnCwd()` (absolute + exists + dir). `WorktreeInfo.workPath` for monorepo subdir scoping. `worktreeRepos` set + dispose pruning. RPC-only; Agent tool surface unchanged. |
| `495ac84` | Foreground lifecycle symmetry: foreground agents now fire `onComplete` and the existing `subagents:started/completed/failed/record` events (previously background-only). `spawnAndWait` returns `{ id, record }` (was `record`) and gains `onSpawned?`. Foreground runs stream to `.output` JSONL. |
| `2b96ad0` | `clearCompleted(skipUnconsumed = false)`; `session_start` / `session_before_switch` pass `true` so `resultConsumed === false` records survive (10-min eviction timer still applies). |
| `c32beeb` | `AgentManager.steer(id, message): boolean` — centralizes steer: live `session.steer()` if running, else pushed to `record.pendingSteers`. |
| `6235f40` | **Forgiving model resolution.** `normalize()` makes `.` ≡ `-`; an `^\d{8}$` trailing token is treated as an optional date stamp; new provider-fallback step retries the bare id across all providers. Explore default de-dated to `anthropic/claude-haiku-4-5`. |

### E. Worktree (`src/worktree.ts`) — out of our scope

| Commit | Change |
| --- | --- |
| `d26ad64` | `WorktreeInfo.baseSha`; `cleanupWorktree` compares HEAD → `baseSha` when the tree is clean (preserves agent-made commits) and uses `git commit --no-verify`. |
| `30bfed0` | `WorktreeInfo.workPath`; subdir scoping via `realpathSync(topLevel)`. |

### F. Internal breaking changes a porter must honor

- `spawnAndWait()` return type: `Promise<AgentRecord>` → **`Promise<{ id, record }>`** (`495ac84`).
- `ConversationViewer` constructor: 6 → **9** params (`onStop?` `e55d391`, `keybindings?` `ceba678`, `onSteer?` `c32beeb`).
- `AgentWidget` constructor gained a `mode: () => WidgetMode` param (`c32e8e0`).
- `clearCompleted(skipUnconsumed)` signature (`2b96ad0`).
- `SettingsAppliers` interface gained 4 hooks (`setDisableDefaultAgents`, `setToolDescriptionMode`, `setFleetView`, `setWidgetMode`).
- `AgentRecord`: `worktree.baseSha`, `worktree.workPath`, `isBackground?` (spawn now writes it).
- No `@earendil-works/pi-coding-agent` peer-dep bump (still `>=0.74.0`).

## Comparison with our port

Legend: ✅ already have / diverge-by-design · ⚠️ gap · ➕ net-new capability.

### Functionality

| Upstream feature | Our state | Verdict |
| --- | --- | --- |
| 3 tools: `Agent` / `get_subagent_result` / `steer_subagent` | We ship **2**: `subagent` / `subagent_status`. No steer tool. | ⚠️ **Gap — borrow the steer tool.** |
| `AgentManager.steer(id, message)` centralization | No `AgentManager`; orchestration in `orchestrate-single.ts` / `orchestrate-batch.ts` / `background-jobs.ts`. We only call `session.steer()` internally for the `max_turns` soft-landing. | ⚠️ **Borrow a steer entry point** at the orchestration layer (see run-agent `forwardAbort` for the signal pattern). |
| Inline steer composer in viewer (`Enter`) | Our `viewer/overlay.ts` has scroll / prev-next / `t` / `e` / `G` / `Tab` / `Esc`. No composer. | ⚠️ **Borrow** — cheap once steer exists. |
| Two-press `x` stop in viewer | No viewer stop; `subagent_status` is read-only. | ⚠️ Minor borrow (ties into steer/abort plumbing). |
| Foreground lifecycle events + `.output` JSONL | We always persist the child session file under `~/.agent/subagents/session` and index it per parent (`paths.ts` `appendSubagentLinkRecord` / `recordSubagentStarted`), which the viewer already tails. We emit `subagent:complete` from `background-finish.ts` only. | ✅ Persisted transcripts already superior; optionally emit lifecycle events for foreground for parity. |
| `SpawnOptions.cwd` / `configCwd` split | We always run at `ctx.cwd`. | ⚠️ Medium-value borrow for monorepo subdir / scout use cases. |
| Forgiving model resolution (`.`≡`-`, date suffix, provider fallback) | `@htwang-contrib/common` `resolveModel` has tiered matching + signal scoring + version compare, but **not** separator equivalence, date-suffix stripping, or provider fallback. | ⚠️ **Borrow into `packages/common`** — shared win for every package. |
| `exclude_extensions` frontmatter | Child loader uses a fixed `CHILD_SESSION_EXTENSION_FACTORIES = [protectSecrets, extraTools, webTools, gitClone]`. Personas cannot tune extensions. | ⚠️ Medium-value borrow; our set is curated so impact is smaller than upstream. |
| `persist_session` / `session_dir` frontmatter | We **always** persist (intentional — the viewer needs the file). Upstream defaults to in-memory. | ✅ Diverge-by-design; skip. |
| `disableDefaultAgents` | We always surface shipped agents. | Low value; skip unless requested. |
| `toolDescriptionMode` (full/compact/custom) | Static tool description + compact catalog XML. | Low value; the `{{typeList}}` placeholder idea is nice but our prompt shape differs. Skip. |
| FleetView `belowEditor` navigator | We use an **on-demand** `/view-subagents` popup (picker + 80%×80% overlay) plus `/subagents-agents`. No persistent widget. | ✅ Diverge-by-design; our model is cleaner for this monorepo. Skip. |
| `widgetMode` / above-editor status widget | We have no persistent status widget (we render live rows via `@htwang-contrib/tool-display`). | ✅ Diverge-by-design; skip. |
| Worktree isolation (`baseSha`, `workPath`, `--no-verify`) | Explicitly out of scope (`DESIGN.md` §1.3). | ✅ Skip. |
| `tui.select.*` keybinding honoring in viewer | Our overlay hardcodes `Key.up/down/...` via `matchesKey`. | Low-medium value; borrow if we want emacs-style `ctrl+p/n`. |
| `/agents → Agent types` redesign with model-availability flags | Our `/subagents-agents` opens a read-only inspect editor with resolved model. | Already covered conceptually; the "model unavailable" flag is a nice touch. Low value. |

### Settings parity (`settings.ts`)

We support: `max_concurrent`, `max_total`, `timeout_ms`, `defaults_by_agent_type`.
Upstream additionally has: `disableDefaultAgents`, `toolDescriptionMode`, `fleetView`,
`widgetMode`. See recommendations above for which to take.

## Recommended borrowable backlog (prioritized)

1. **Steer tool + central steer entry point** (`c32beeb`, `e55d391`).
   - Add a `steer_subagent`-equivalent tool (our naming: likely `subagent_steer`
     to match our `subagent_status` convention, or reuse `subagent` with a
     `steer` mode).
   - Expose a `steer(id, message)` entry alongside the orchestration layer
     (background jobs already track ids in `background-jobs.ts`; foreground needs
     a handle to the live `AgentSession`).
   - Use the same signal-forwarding shape as `forwardAbort` in `run-agent.ts`.
   - Wire the inline composer (`Enter`) and two-press `x` stop into
     `viewer/overlay.ts` (`onSteer`, `onStop` callbacks like upstream).
2. **Forgiving model resolution in `@htwang-contrib/common`** (`6235f40`).
   - Extend `packages/common/src/model-resolve.ts` with separator equivalence
     (`.` ≡ `-`), optional trailing `^\d{8}$` date stamp, and a provider-fallback
     pass. Every package using `resolveModel` benefits.
3. **`SpawnOptions.cwd` / `configCwd` split** (`30bfed0`).
   - Let a single or batch run target a different directory while keeping config
     discovery on the parent project. Add `assertValidSpawnCwd()`. Useful for
     monorepo subdirs and a future scout-in-worktree flow.
4. **`exclude_extensions` frontmatter** (`d761e11`).
   - Parse `exclude_extensions` in `agent-catalog.ts`; apply in `run-agent.ts`
     against `CHILD_SESSION_EXTENSION_FACTORIES`. Emit a warning for unknown ids.
5. **Viewer `tui.select.*` keybindings** (`ceba678`) — cheap quality-of-life if
   we want emacs-style navigation.

### Explicitly not borrowing

- FleetView, `widgetMode`, above-editor status widget — we deliberately chose an
  on-demand popup (`/view-subagents`) over a persistent widget.
- Worktree isolation — out of scope per `DESIGN.md`.
- `persist_session` / `session_dir` — we intentionally always persist.
- `disableDefaultAgents`, `toolDescriptionMode` — low value for our setup.

## Revision log

| Date | Note |
| --- | --- |
| 2026-07-05 | First upstream-tracking audit. Baseline `4b8f45a` → HEAD `8405e55` (v0.13.0). Identified steer + model-resolution + cwd + exclude_extensions as borrowable. |
