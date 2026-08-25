# Upstream tracking — `tintinweb/pi-subagents`

This file tracks the upstream `tintinweb/pi-subagents` repository so we can resume
diffing from a known point each session instead of re-auditing from scratch.

- **Source repo:** https://github.com/tintinweb/pi-subagents
- **Our port:** `packages/subagents/`
- **Design notes:** [`DESIGN.md`](./DESIGN.md) · step checklist: [`STEPS.md`](./STEPS.md)
- **Last upstream audit before this port:** **2026-06-01** (see `DESIGN.md` revision log)

> **Decision (2026-07-05): the maintainer reviewed the full diff and declined
> every borrowable item.** See
> [§ Not borrowing — user-declined](#not-borrowing--user-declined-2026-07-05).
> **Update (2026-07-27): the maintainer reopened the audit; two robustness fixes
> were borrowed (`#147` max thinking level, `#144` failed-final-turn detection)
> and the rest were either verified not-applicable to our architecture or
> re-confirmed declined.** See
> [§ Borrowed / not-applicable — 2026-07-27](#borrowed--not-applicable--2026-07-27).
> **Update (2026-09-12): third audit (v0.14.3 → v0.18.2); six items borrowed.**
> See [§ Borrowed — 2026-09-12](#borrowed--2026-09-12).

## Commit pointers

| Role | SHA | Date (UTC+2) | Subject |
| ---- | --- | ---- | ------- |
| **Our baseline** (last audited) | `4b8f45a909492d82239553c63e8cdebcfbdf8ac9` | 2026-06-01 | `e2e tests` (parent of the first substantive June commit `e55d391`) |
| **Upstream HEAD (this audit)** | `ad81024825b315577692b785831262874e66be95` | 2026-08-24 | `v0.18.2` |

> Next session: `git -C <cache> fetch && git log ad81024..origin/main` to see only
> what landed since this audit. Update the HEAD row above when you re-audit.

## What changed upstream (2026-06-01 → 2026-06-30, v0.13.0 audit)

Only substantive commits are listed (version bumps, README-only, and pure test
scaffolding are omitted). Grouped by theme. This section is **reference
material**, not a to-do list.

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

## What changed upstream — 2026-06-30 → 2026-07-26 (v0.14.0 → v0.14.3 audit)

36 commits. Most extend the already-declined directions (FleetView polish, steer
composer, worktree). The items below are the ones evaluated for borrowing in the
2026-07-27 audit.

### Borrowed / not-applicable — 2026-07-27

#### Borrowed

| Commit | Change | Outcome |
| --- | --- | --- |
| `2d0eb9b` (#147) | Advertise pi 0.80's `max` `ThinkingLevel` across the tool/wizard surfaces. | **BORROWED.** Our `THINKING_LEVELS` set in `run-agent.ts` omitted `max`, so `thinking: "max"` was silently rejected by `parseThinking` and fell back to the default — even though `inference-self-host`'s GLM-5.2 / DeepSeek maps already handle `max`. Added `max` to the set and enriched both `thinking` tool-param descriptions to enumerate the levels. |
| `441dd4c` + `f8116ee` (#144) | Report a failed final assistant turn (`stopReason "error"`, or `"length"` with no text) as `error`, not `completed` with an empty or stale result. | **BORROWED.** `extractAssistantText` walked back past an empty failed final turn and returned an *earlier* turn's text as the answer. Added `finalTurnError()`; wired into `runSubAgent` (`isError`/`errorMessage`); partial text is surfaced in `orchestrate-single`, `orchestrate-batch`, and `batch-text`. |

#### Verified not applicable — do not re-investigate

| Commit | Why it does not bite us |
| --- | --- |
| `4cc76c0` (#152) isolated custom providers lost on Pi 0.80.8+ | We pass the correct `modelRuntime` option (not the deprecated `modelRegistry`), and the child session loads our provider extensions (`inferenceSelfHost` / `inferenceV2SelfHost`) via `CHILD_SESSION_EXTENSION_FACTORIES`; `pi.registerProvider` writes into that same runtime. Upstream was bitten because their isolated mode disabled extension loading. |
| `9afc801` (#128) `Symbol.for("pi-subagents:manager")` clobber by child activations | We keep no `Symbol.for` registry. |
| `409da8a` (#145) `.output` stream freeze after session compaction | We do not stream to a separate `.output` file; the viewer tails the session JSONL via `buildSessionContext`, which already resolves compaction. |
| `878ce00` (#127) / `4738533` (#159) `get_subagent_result(wait:true)` queue + abort | Our `subagent_status` is read-only with no wait path. |
| `92dcc52` (#157) async-registered extension tools (MCP) in subagents | Fixed `CHILD_SESSION_EXTENSION_FACTORIES`, no MCP; the static `tools:` allowlist cannot drop a late-registered tool. |
| `226f03b` (#142) RPC registration gated on `session_start` | No cross-extension RPC surface. |
| `a47595a` (#166) user-memory `PI_CODING_AGENT_DIR` | Our memory model differs; no `memory: user` agent pinning that hardcodes `~/.pi`. |
| `7275213` (#143) extension match by package short name | We have no `exclude_extensions`; child extension scoping is a fixed factory list. |
| `3ed8632` (#174) foreground result "output may be partial" wording | Our foreground tool result already composes its own outcome note; not a behavior fix. |

#### Still declined (unchanged from 2026-07-05)

FleetView polish (`4bbab47` markers, `55e0885` key-focus, `d54dba2` row width,
`044824b` nested ANSI), `output_transcript` / `outputTranscript` opt-out
(`8c89823` — we always persist the session by design), and every item in the
original [§ Not borrowing — user-declined](#not-borrowing--user-declined-2026-07-05).

## What changed upstream — 2026-07-26 → 2026-08-24 (v0.14.3 → v0.18.2 audit)

56 commits, 10 releases (0.15.0 … 0.18.2). Themes: `@handle` mentions +
tombstone resume + `name`/`color` frontmatter (0.16.0/0.17.0), opt-in nested
delegation (`8976c63`, #164), `rememberAgents` persist-by-default (0.17.0 — we
already always persist), `backgroundByDefault` breaking flip (0.18.0 — we stay
foreground-by-default), `maxConcurrentForeground` (#260), usage reporting
(`cd306b2`, #193/#243), and a run of robustness fixes.

### Borrowed — 2026-09-12

| Upstream | Change | Our adaptation |
| --- | --- | --- |
| `9afe114` (#242) | Emit `session_shutdown` before disposing child sessions | `common/src/agents/session-shutdown.ts` `shutdownChildSession()` (emit with 3s ceiling via `extensionRunner.hasHandlers`/`emit`, then always `dispose()`); wired into the `finally` of both `runChildAgent` and `runIsolatedSession` — ours previously never disposed child sessions at all. |
| `c83dd82` (#179) | Spawn-never-started fails the tool call (pi discards `isError` on returned results) | `runChildAgent` setup phase (session dir, loader, `createAgentSession`, `bindExtensions`) now throws; run phase still settles on the result. `orchestrate-batch` converts a per-task setup throw into that item's error result so one bad task cannot fail the batch. `runIsolatedSession` already had these semantics. |
| `cd306b2` (#193/#243) | `reportUsage`: fold child spend into parent `getSessionStats()` via tool-result `usage` | `subagents/src/usage-report.ts`: `toPiUsage()` maps the (extended) `ChildAgentUsageSnapshot` (now with `usage_cache_read`/`usage_cache_write`/`usage_cost_usd`) to pi's `Usage`; attached on foreground single/batch results. Background completions go to a per-parent-session pool drained onto the next `subagent`/`subagent_status` result. Config via `/config` → Subagents → `reportUsage` (default off), per the repo's ConfigItem convention instead of upstream's `subagents.json` key. |
| `c73e968` (#255) | Ctrl+C closes the conversation viewer | `viewer/overlay.ts` `handleInput` treats `ctrl+c` like `escape`, matching pi's `tui.select.cancel` defaults. |
| `140324c` (#212) | Malformed agent files skipped with a warning | `agent-personas.ts`: broken frontmatter now throws at parse (previously silently treated the whole file as prompt body); the catalog collects `warnings: string[]` naming the file (+ the surviving same-id file when overridden), logs them via the extensions log, and the `subagent` tool surfaces them through `ctx.ui.notify`. `strictAgentFiles` not borrowed. |
| `2966cd5` (#183) | `fallbackSubagent` — fail-closed dispatch for unknown types | `fallback_agent` key in `~/.agent/subagents/settings.json`: omitted = `general-purpose` (today), a persona id = route there, `"none"`/`false` = the tool call fails listing available types. Enforced in `validateTaskShape` via `resolveDispatchAgentId`; orchestrators thread the resolved id so a named fallback actually governs prompt/tools. |

### Verified already-covered or not applicable this round

- `rememberAgents` persist-by-default (0.17.0) — we always persist child sessions.
- Viewer markdown rendering (`917853c`, #259) — our viewer renders via pi's `AssistantMessageComponent` with `getMarkdownTheme()`.
- Frontmatter `name:` as dispatch identity (0.17.0) — our `personaIdFromFrontmatter` already implements it.
- #168 effective-model display — our viewer reads the child session's `model_change` events.
- #199 renderer catch-all — our renderers key off explicit `details` fields, no equivalent fall-through.
- #224/#249/#181 RPC-spawn UI tracking, `a9db27b` `rpc:consume`, `084d177` RPC `scopeModels` — no cross-extension RPC surface.
- #205 `parentSession` header — our `SessionManager.create` already passes it.
- `maxConcurrentForeground` (`e56085d`, #260) — our batch path already caps via `max_concurrent`; foreground singles block the parent turn, and we have no evidence of local-model prompt-cache thrash. Not borrowed.
- `@handle` mentions, tombstone resume, `name` param, nested delegation (#164), `backgroundByDefault` flip, `worktreeIsolation`/`isolation: "off"`, FleetView/widget/showModel/color badges — all extend previously declined directions; still declined.
- `973dc6f` nanoid bump — we have no nanoid dependency.

## Comparison with our port

Legend: ✅ already have / diverge-by-design · ⚠️ upstream-only capability.

> The **Verdict** column documents the audit finding only. **All "borrow"
> recommendations were declined by the maintainer on 2026-07-05** (see the
> decision section below). Treat any ⚠️ row as "upstream has it, we do not, and
> we are keeping it that way" unless that decision is explicitly reopened.

### Functionality

| Upstream feature | Our state | Verdict |
| --- | --- | --- |
| 3 tools: `Agent` / `get_subagent_result` / `steer_subagent` | We ship **2**: `subagent` / `subagent_status`. No steer tool. | ⚠️ Upstream-only; declined. |
| `AgentManager.steer(id, message)` centralization | No `AgentManager`; orchestration in `orchestrate-single.ts` / `orchestrate-batch.ts` / `background-jobs.ts`. We only call `session.steer()` internally for the `max_turns` soft-landing. | ⚠️ Upstream-only; declined. |
| Inline steer composer in viewer (`Enter`) | Our `viewer/overlay.ts` has scroll / prev-next / `t` / `e` / `G` / `Tab` / `Esc`. No composer. | ⚠️ Upstream-only; declined. |
| Two-press `x` stop in viewer | No viewer stop; `subagent_status` is read-only. | ⚠️ Upstream-only; declined. |
| Foreground lifecycle events + `.output` JSONL | We always persist the child session file under `~/.agent/subagents/session` and index it per parent (`paths.ts` `appendSubagentLinkRecord` / `recordSubagentStarted`), which the viewer already tails. We emit `subagent:complete` from `background-finish.ts` only. | ✅ Persisted transcripts already superior to upstream. |
| `SpawnOptions.cwd` / `configCwd` split | We always run at `ctx.cwd`. | ⚠️ Upstream-only; declined. |
| Forgiving model resolution (`.`≡`-`, date suffix, provider fallback) | `@htwang-contrib/common` `resolveModel` has tiered matching + signal scoring + version compare, but **not** separator equivalence, date-suffix stripping, or provider fallback. | ⚠️ Upstream-only; declined. |
| `exclude_extensions` frontmatter | Child loader uses a fixed `CHILD_SESSION_EXTENSION_FACTORIES = [protectSecrets, extraTools, webTools, gitClone]`. Personas cannot tune extensions. | ⚠️ Upstream-only; declined. |
| `persist_session` / `session_dir` frontmatter | We **always** persist (intentional — the viewer needs the file). Upstream defaults to in-memory. | ✅ Diverge-by-design. |
| `disableDefaultAgents` | We always surface shipped agents. | ⚠️ Upstream-only; declined (low value). |
| `toolDescriptionMode` (full/compact/custom) | Static tool description + compact catalog XML. | ⚠️ Upstream-only; declined (low value). |
| FleetView `belowEditor` navigator | We use an **on-demand** `/view-subagents` popup (picker + 80%×80% overlay) plus `/subagents-agents`. No persistent widget. | ✅ Diverge-by-design. |
| `widgetMode` / above-editor status widget | We have no persistent status widget (we render live rows via `@htwang-contrib/tool-display`). | ✅ Diverge-by-design. |
| Worktree isolation (`baseSha`, `workPath`, `--no-verify`) | Explicitly out of scope (`DESIGN.md` §1.3). | ✅ Out of scope. |
| `tui.select.*` keybinding honoring in viewer | Our overlay hardcodes `Key.up/down/...` via `matchesKey`. | ⚠️ Upstream-only; declined. |
| `/agents → Agent types` redesign with model-availability flags | Our `/subagents-agents` opens a read-only inspect editor with resolved model. | ✅ Covered conceptually; the model-unavailable flag is a minor nicety we skipped. |

### Settings parity (`settings.ts`)

We support: `max_concurrent`, `max_total`, `timeout_ms`, `defaults_by_agent_type`.
Upstream additionally has `disableDefaultAgents`, `toolDescriptionMode`,
`fleetView`, `widgetMode` — all **declined** (see decision below).

## Not borrowing — user-declined (2026-07-05)

On 2026-07-05 the maintainer reviewed the full 2026-06-01 → HEAD diff and
**declined every borrowable item**. The absence of each feature below is
intentional. **Do not re-propose these on future audits** unless the maintainer
explicitly reopens one.

- **Steer tool / central steer entry point / viewer steer composer / two-press
  `x` stop** (`c32beeb`, `e55d391`). We keep exactly the two tools `subagent` +
  `subagent_status`; the parent cannot redirect a running subagent.
- **Forgiving model resolution** (`.`≡`-`, date suffix, provider fallback,
  `6235f40`). `@htwang-contrib/common`'s `resolveModel` keeps its current tiered
  + signal + version matching.
- **`SpawnOptions.cwd` / `configCwd` split** (`30bfed0`). Runs always use
  `ctx.cwd`.
- **`exclude_extensions` frontmatter** (`d761e11`). The child loader keeps its
  fixed `CHILD_SESSION_EXTENSION_FACTORIES = [protectSecrets, extraTools,
  webTools, gitClone]`.
- **Viewer `tui.select.*` keybindings** (`ceba678`). The overlay keeps its
  hardcoded `Key.*` via `matchesKey`.
- **FleetView, `widgetMode`, above-editor status widget** (`5889ab0`,
  `c32e8e0`). We deliberately use an on-demand `/view-subagents` popup instead
  of a persistent widget.
- **Worktree isolation** (`d26ad64`, `30bfed0`). Out of scope per `DESIGN.md`
  §1.3.
- **`persist_session` / `session_dir` frontmatter** (`d2027ac`). We
  intentionally always persist (the viewer depends on the session file).
- **`disableDefaultAgents`** (`f5c5805`) and **`toolDescriptionMode`**
  (`d9a3c4f`). Low value for our setup.

### What future audits should touch

Only:

1. The **HEAD row** in *Commit pointers* (advance it after a fresh
   `git log <old-head>..origin/main`).
2. A new **revision-log** line below.
3. Optionally new rows in the *What changed upstream* change log if a commit
   looks material enough to record for context.

The decision section above is **not** a re-evaluation queue.

## Revision log

| Date | Note |
| --- | --- |
| 2026-07-05 | First upstream-tracking audit. Baseline `4b8f45a` → HEAD `8405e55` (v0.13.0). Change log recorded. Maintainer reviewed the full diff and **declined every borrowable item**; future audits advance pointers + change log only unless an item is explicitly reopened. |
| 2026-07-27 | Second audit (reopened). HEAD advanced `8405e55` → `3ed8632` (v0.14.3). Of 36 new commits, **two borrowed**: `2d0eb9b` (#147 `max` thinking level) and `441dd4c`+`f8116ee` (#144 failed-final-turn → error). Nine verified **not-applicable** to our architecture (#152, #128, #145, #127, #159, #157, #142, #166, #143, #174). Remainder re-confirmed declined. |
| 2026-09-12 | Third audit. HEAD advanced `3ed8632` → `ad81024` (v0.18.2). Of 56 new commits, **six borrowed**: #242 (session_shutdown + dispose), #179 (setup failures throw), #193/#243 (reportUsage, via `/config` not settings.json), #255 (Ctrl+C closes viewer), #212 (malformed persona file warnings), #183 (`fallback_agent` fail-closed dispatch). Everything else verified already-covered, not-applicable, or still declined (see the 2026-09-12 section). |
