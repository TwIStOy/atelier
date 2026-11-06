# Changelog

## [Unreleased]

### Added

- `gateway-provider.ts`: shared refresh-command handler factory (`makeRefreshCommandHandler`), cached-refresh skeleton (`refreshModelsCatalog`), and gateway models fetch (`fetchGatewayModels`) used by the magpie and toori providers; `scroll-keys.ts` with `scrollKeyOffset` for overlay up/down scrolling (btw, committer).
- `frame-epoch.ts` with `currentFrameEpoch` / `patchTuiFrameEpoch` (moved from tool-display's render-cache so every extension's frame-scoped caches share one counter; patching the same TUI twice is a no-op) and `findComponentContextInFrame`, a per-frame sibling index that turns N per-component `findComponentContext` tree walks per frame into one walk plus O(1) lookups (targets attached mid-frame fall back to the direct walk). `AsyncAnnotations.size()` exposes the value count.
- Fine-grained `exports` subpaths for every module exposed through the root entry, allowing consumers to load only the implementation modules they use instead of evaluating the full root barrel.

### Changed

- `findComponentContext` / `findComponentContextInFrame` now search a TUI's `overlayStack` in addition to its layout `children`. Components rendered inside an extension overlay (e.g. the `/view-subagents` viewer's tool rows) previously resolved no sibling context, so host-side grouping and spacing logic went idle there.

- `readConfig()` no longer `statSync`s `extensions.json` on every call: the stat is gated by a 500 ms TTL (`CONFIG_STAT_TTL_MS`, exported) and the missing-file case is cached as a sentinel, so render paths calling `loadConfig()` per tool row per frame issue at most one stat per window. In-process writes still refresh the cache immediately; only edits made by other processes are observed after the TTL.

- `componentRendersLines` memoizes top-level visibility probes by component and width within each frame, allowing grouping and spacing consumers to share one render probe. Nested probes retain their non-rendering recursion guard, and unpatched epoch-0 renders still probe directly.

- Split oversized internal functions in `telemetry.ts` (`finalizeTurn`, `formatTurnTelemetry`), `diff.ts` (`generateUnifiedDiff`), `mcp.ts` (`mcpCall`), `gateway-provider.ts` (`refreshModelsCatalog`), and the agent modules (`child-agent.ts` `runChildAgent`, `isolated-session.ts` `runIsolatedSession`/`lastAssistantText`, `agent-personas.ts` `buildAgentPersonaCatalog`, `persona-defaults.ts` `parsePersonaDefaultsByType`, `subagent-models.ts` `loadSubagentModelConfig`) into smaller phase helpers to clear all `fallow health` complexity findings; exported names, signatures, and behavior are unchanged.
- Runtime consumers in `packages/*/src` and `extensions/*/src` now import common through fine-grained subpaths. Biome `noRestrictedImports` rejects new root-entry imports in those source trees, preventing the startup module graph from silently regrowing.

### Removed

- `ASK_USER_BLOCKED_EVENT` (`"ask_user_question:blocked"`) and `AskUserBlockedPayload`, whose only consumer was the removed `moshi-hooks-extra` extension. `MODAL_ACTIVE_EVENT` and `ASK_USER_PROMPT_EVENT` are unchanged.
- `TurnTelemetryTracker.discardCurrentTurn()` — designed for abort wiring that never landed.

## [0.7.0] - 2026-10-30

### Fixed

- Aggregate Rule registrations from other extensions (`registerAggregateRule` in memory / web-tools / todo) never reached tool-display in a real session: pi loads each extension through a separate jiti module graph (`moduleCache: false`), so the module-level `Map` gave every extension its own registry copy and only the built-in four rules ever grouped. The registry now lives in Symbol.for-keyed global state (same pattern as the system-prompt contribution registry), and built-ins seed inside the `getGlobalState` init callback instead of at module evaluation — every extension re-evaluates this module, so a top-level reseed would wipe registrations made by earlier-loaded extensions. Verified against a live headless pi session: cross-extension rules are visible to readers after the fix.

- `componentRendersLines` no longer recurses without bound when two patched renders probe each other. Compact-thinking's leading-blank walk and tool-display's grouping/spacing both call sibling `render` to decide visibility; those patches also scan siblings during `render`, which previously overflowed the call stack (`RangeError: Maximum call stack size exceeded` in `findComponentContext` / `truncateToWidth`). A nested probe now treats the sibling as visible and returns without calling `render` again. Probe depth is stored on `globalThis` so duplicate copies of this package (separate extension loaders) share the same guard.
- Extension config reads/writes (`readConfig` / `writeConfig` / `updateConfig` and the key-level helpers) now resolve `extensions.json`'s path on every call instead of capturing it in a module-level constant. In a real session the `XDG_CONFIG_HOME` environment is static so behavior is unchanged, but tests that stub the env after the module first evaluated previously kept reading the stale path.

### Added

- Cross-extension goal channel `GOAL_UPDATE_EVENT` (`"goal:update"`) with the minimal consumer-facing payload contract `GoalUpdatePayload` (non-null payload carries `status: "active" | "paused" | "budgetLimited" | "complete"`; other goal fields are owned by `goal` and not contractual) ([#6](https://github.com/TwIStOy/pi-extensions/issues/6)).
- Shared rail subrow indentation and render-time layout selection keep grouped tool and thinking bullets, body columns, and wrapping widths aligned. The thought-group expansion marker lets grouping consumers update thinking layout without rebuilding its content.
- Shared `findExecutable`, `getLocalRexContext` and `openRexPane` helpers resolve executable paths, verify a local Rex session, and launch an explicitly anchored pane without changing focus or interpolating a shell command.
- Shared subagent model-tier configuration and resolution (`loadSubagentModelConfig`, `resolveSubagentModelPattern`, `SUBAGENT_MODEL_TIERS`). `runChildAgent` applies per-persona model overrides before persona frontmatter and resolves tier references for all child-agent callers while preserving current-session fallback.
- Shared `createComplexityAssessment` for transcript annotations, preserving complete conversation text and image type markers.
- Public `resolveConfigValue(value, env?)` and `getConfigEnvVar(value)` helpers resolve string configuration values from `$VAR` / `{env:VAR}` references without service-specific fallback rules. Exported from the main entry and the Pi-independent `@htwang-contrib/common/config` subpath. System One now uses these helpers while retaining its credential precedence and validation.
- System One `apiKey` settings and per-call overrides accept `$VAR` and `{env:VAR}` environment-variable references. Explicit references take precedence over `TYPESAFE_API_KEY`, resolve on each call, and reject missing credentials without falling back. The configuration editor preserves the reference instead of exposing or persisting the resolved secret.
- `AsyncAnnotations<T>` shares background display-annotation deduplication, cancellation, and stale-result guards between user-message and tool-display. Requests do not block event handlers; reset and disposal abort pending work and discard late results.
- Shared TypeSafe System One interface (`systemOne`) with typed `noul`, `choice`, and `score` builders, reusable response and error types, live ConfigItem settings, environment and per-call overrides, cancellation, timeouts, and SDK retries. Available from the main entry and the Pi-independent `@htwang-contrib/common/systemone` subpath. Uses the official `@typesafe-ai/sdk`; see `docs/common/SYSTEMONE.md` for configuration and examples.
- Child extension factory registry (`src/agents/child-extensions.ts`): any extension loaded in the main session can inject extra `ExtensionFactory`s into every `runChildAgent` child session (subagents, the `workflow` tool, the goal verifier). `registerChildExtensionFactory(id, factory)` registers under a caller-chosen id — re-registering the same id replaces the previous factory, so `/reload` re-registration is safe — and returns an unregister function that is a no-op if the id has since been re-registered; `getChildExtensionFactories()` reads the current list in registration order. The registry lives in `Symbol.for`-keyed global state (`CHILD_EXTENSION_FACTORIES_STATE_KEY`, exported for test cleanup), so registration works even though pi loads each extension through a separate jiti module graph and even when a package carries its own copy of this module. `runChildAgent` appends registered factories after the caller-supplied `extensionFactories`, which is now optional (omit it to rely on the registry alone). `runIsolatedSession` intentionally does not consult the registry — isolated side-calls stay minimal.
- Aggregate Rule registry (`src/aggregate-rules.ts`): one shared `toolName → { verb, singular, plural, progressive }` table phrasing tool-display's verb-group and truncation header rows ([#157](https://github.com/TwIStOy/pi-extensions/issues/157)). Built-in rules cover `grep` / `glob` / `ls` / `read`; extensions add rules via `registerAggregateRule(toolName, rule)` (first registration wins; identical re-registration is a reload-safe no-op) or, without a common dependency, by emitting `AGGREGATE_RULE_REGISTER_EVENT` (`"tool-display:register-aggregate-rule"`) on `pi.events` — tool-display bridges the event into this registry and emits `AGGREGATE_RULE_READY_EVENT` once it listens. A tool name without a rule is never a verb-group Member.
- Thought-member layout contract (`setThoughtMember` / `isThoughtMember`, `setThoughtMemberClaimed` / `isThoughtMemberClaimed`, `setThoughtTransparent` / `isThoughtTransparent` in `src/tool-rail.ts`) ([#157](https://github.com/TwIStOy/pi-extensions/issues/157)): the owner of a thinking block (compact-thinking) marks a finished, collapsed, text-free assistant component as an eligible ThoughtMember and marks streaming or user-expanded text-free thinking as Transparent. The grouping consumer (tool-display's verb-group) claims eligible members by stamping them claimed; only claimed members render zero lines, so a standalone finished thinking block keeps its heading row while one folded into a verb-group disappears without breaking the span. Claims are re-synced on every content rebuild and every grouping scan.
- Component-tree sibling lookup (`findComponentContext` / `componentRendersLines` in `src/component-tree.ts`): locate a component's containing `children` array by identity (recursive walk from any root) and probe whether a sibling renders any lines at a given width. Extracted from tool-display's chat-sibling scanning and now also used by compact-thinking to decide, at render time, whether a thinking-led message joins the rail column of the sibling above or keeps a separator blank line.
- Rail-tail spacing marker (`setRailTailSpacing` / `clearRailTailSpacing` / `readRailTailSpacing` in `src/tool-rail.ts`): a cross-extension contract for the rail column's vertical rhythm. A component whose rendered output ends with a thinking-rail line (compact-thinking's collapsed or expanded run) marks itself with the number of blank lines it already emitted after that rail line; rail-aware consumers below (tool-display's group spacing) read the marker and skip their own leading blank line so the marker value fully owns the gap. Unmarked or cleared components fall back to the consumer's default spacing.
- Shared rail column renderer (`src/tool-rail.ts`) for the grok-style unified tool-call / thinking block layout ([#143](https://github.com/TwIStOy/pi-extensions/issues/143)): `renderRailLines(bodyLines, spec, theme, width)` composes the fixed column contract (rail at column 2, bullet at column 5, body at column 7) with `RailMark` (`"aggregate"` `❙` / `"run"` `┃` / `"none"`), `RAIL_BULLET_SINGLE` `◆` / `RAIL_BULLET_AGGREGATE` `◈` or a caller-supplied spinner frame, optional `RailStatus` (`success` / `error` / `dim`) coloring of rail+bullet, an optional `railStatus` that overrides just the rail color while the bullet keeps `status`, and a `RailBar` custom rail (static string or `(row, rows) => string` callback returning possibly-ANSI output, re-evaluated on every render so animations advance on redraw without rebuilding content). `TOOL_RAIL_LAYOUT` / `toolRailBodyWidth(width)` expose the layout and body width budget, and `ToolRailComponent` wraps a pi-tui `Component`, rendering the inner component at the body width and propagating `invalidate()`. Every composed line is truncated ANSI-aware to the passed width ([#143](https://github.com/TwIStOy/pi-extensions/issues/143)).
- `generateUnifiedDiff(filePath, oldText, newText)` in `src/diff.ts`: git-style unified diff generation with 3-line context, shared by the apply-patch tool's preview details and tool-display's Edit/apply_patch adapters. Standalone `\n` tokens from `newlineIsToken` diffing are folded into the preceding token so trailing newlines no longer produce a phantom empty context line or inflated hunk counts.
- `registerTuiCommands(pi, register)` in `src/tui-commands.ts`: registers TUI-only slash commands from a `session_start` handler gated on `ctx.mode === "tui"`. Extension factories run before the runner's mode is bound (mode is still the `"print"` default there), so mode-gated command registration must be deferred; `session_start` fires after `bindExtensions`, before the TUI builds its autocomplete provider, and re-fires on reload/session switches (registration is idempotent).
- Config file caching in `readConfig` (`src/config/extension-config.ts`): `extensions.json` is cached by path + mtime + size, so repeated `readConfig` calls cost one `statSync` instead of a full `readFileSync` + `JSON.parse` each — render paths call this per component per frame. In-process writes (`writeConfig` / `updateConfig` / key-level helpers) refresh the cache eagerly; external edits are picked up on mtime change. The new `getConfigFileVersion()` export returns a counter bumped on every in-process write and every observed external change, giving render caches a cheap key for config state.
- `componentRenderProbeDepth()` in `src/component-tree.ts` exposes the current `componentRendersLines` probe depth, so render caches can distinguish top-level renders from probed ones (nested probes short-circuit sibling visibility, which changes spacing resolution).

### Removed

- Session-title generation, virtual-model status and context overrides, and routing-tier exports used by the removed `herdr`, `htw-producer`, and `virtual-model` extensions.
- Z.AI Coding Plan usage event constants and quota types after removal of the extension and its consumers.

## [0.6.1] - 2026-09-01

### Added

- `registerLogFileSizeWarning(pi)` installs a one-time check that runs only during Pi startup. The root extension bundle registers it and warns the user when `$XDG_STATE_HOME/pi/extensions.log` exceeds 500 MiB.
- `src/agents/session-shutdown.ts`: `shutdownChildSession(session)` closes the extension lifecycle a child session opened with `bindExtensions` — emits `session_shutdown` (reason `quit`) when the runner has handlers for it, raced against a 3s ceiling, then always calls `dispose()`. Pi's own `AgentSession.dispose()` only invalidates the runner, so without the emit anything an extension armed in `session_start` leaked once per spawn (upstream tintinweb/pi-subagents#242).
- `AgentPersonaCatalog` gains a `warnings: string[]` field. `buildAgentPersonaCatalog` now skips an unreadable/unparseable persona file and records a warning naming the file (and the surviving same-id file when the malformed one would have overridden it) instead of silently swallowing it or treating the whole file as prompt body; warnings are also written to the extensions log (upstream tintinweb/pi-subagents#212).
- `ChildAgentUsageSnapshot` gains optional `usage_cache_read` / `usage_cache_write` / `usage_cost_usd`, populated from the child session's `getSessionStats()`.

### Fixed

- `runChildAgent` now aborts correctly in two previously-missed windows: an already-aborted `signal` at call time returns an `Operation aborted` error result before creating any child session, and `forwardAbort` invokes the child `session.abort()` immediately when the signal was aborted before listener registration (an `abort` listener on an already-aborted `AbortSignal` never fires). Previously a parent abort landing during child-session construction left the subagent running to completion with no way to stop it.
- `runChildAgent` and `runIsolatedSession` now dispose the child `AgentSession` via `shutdownChildSession` in a `finally`, so child sessions no longer accumulate for the lifetime of the parent process.
- `runChildAgent` setup failures (session directory creation, resource loader, `createAgentSession`, `bindExtensions`) now throw instead of returning an `isError` result: pi marks a tool call failed only when `execute` throws and discards `isError` on a returned result, so a child that never started previously read as an agent that ran and reported a problem (upstream tintinweb/pi-subagents#179). Run-phase failures still settle on the result.

## [0.6.0] - 2026-08-19

### Added

- System-prompt contribution registry (`src/system-prompt-contributions.ts`): extensions register an `id` + `priority` + callback at factory time; optional `mode` is `"append"` (default, join onto the current prompt) or `"replace"` (callback return value becomes the whole current prompt). `installSystemPromptAssembler` (also invoked by `registerSystemPromptContribution`) attaches one idempotent `before_agent_start` handler that applies non-empty callback results in priority order via `applySystemPromptContributions`. Documented ids must use the ledger priorities in `SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES` (see `docs/common/SYSTEM-PROMPT-PRIORITIES.md`). Empty / null / whitespace results skip that turn. A throwing callback is logged and skipped.

## [0.5.0] - 2026-08-12

### Changed

- The shipped persona directory moved out of `subagents` to the **monorepo root** `agents/` (explore / general-purpose / plan / scout). `buildAgentPersonaCatalog` now always prepends that shared directory to the first discovery layer (resolved relative to the module via `sharedPersonasDir()`, exported), so every caller — subagents, the `workflow` tool, or any future extension — gets the shipped personas for any cwd without injecting `shippedDirs`. The `shippedDirs` option still appends extra caller-specific directories after it.

### Added

- `src/agents/agent-personas.ts`: the Markdown persona catalog promoted out of `subagents` (`buildAgentPersonaCatalog` / `resolvePersonaId` / `personaSystemPrompt` / `personasCatalogXml` / `normalizePersonaId`, types `AgentPersonaCatalog`/`AgentPersonaEntry`/`AgentPersonaFileOptions`). Discovery layers are unchanged (shipped dirs → `~/.config/pi/agents` → `<cwd>/.pi/agents` → project `pi.agents` → project extensions' `pi.agents`), except the shipped-agents directory is now caller-supplied via `buildAgentPersonaCatalog(cwd, { shippedDirs })` so any extension can inject its own bundled personas.
- `src/agents/child-tools.ts`: child-session tool allowlists promoted out of `subagents` (`childSessionToolNames` / `resolveChildToolNames`). The delegation exclusion set is now `CHILD_DELEGATION_TOOL_NAMES = ["subagent", "subagent_status", "workflow"]` so workflow children never receive either orchestration tool.
- `src/agents/persona-defaults.ts`: `defaults_by_agent_type` reading/parsing promoted out of `subagents`' `settings.ts` (`parsePersonaDefaultsByType` / `readPersonaDefaultsByType` / `personaDefaultsForType` / `personaDefaultsFilePath`, same `~/.agent/subagents/settings.json` location). `runChildAgent` now applies the full option precedence chain itself via the new exported pure helper `resolveEffectiveChildOptions(input, fileOptions, personaDefaults)`: call input → persona frontmatter → `defaults_by_agent_type` → runner fallback, covering `model`, `thinking`, `inherit_context`, `isolated`, and `max_turns`. Previously the merge lived only in subagents' orchestration layer, so any other `runChildAgent` caller (e.g. the `workflow` tool) silently ignored persona `model`/`thinking` settings.
- `src/agents/child-agent.ts`: `runChildAgent(ctx, input, signal?)` — the full child-agent runner promoted and generalized out of `subagents`' `run-agent.ts`. Callers supply `extensionFactories` and `sessionDir`; persona resolution goes through the shared catalog. New `outputSchema?: TSchema` option: when set, the child session gets an extra `structured_output` custom tool (`Type.Unsafe` parameters, `terminate: true` so the tool call ends the session without a trailing assistant turn) and the result carries the captured structured `value`; a child that never calls it is reported as an error. Also exports `parseThinking`, `extractAssistantText`, `finalTurnError`, `STRUCTURED_OUTPUT_TOOL_NAME`, and the `ChildAgentUsageSnapshot`/`ChildAgentProgress`/`RunChildAgentInput`/`RunChildAgentResult` types. `assistantMessageText` (join + trim semantics, distinct from `message-text.ts`) is exported from a new `@htwang-contrib/common/child-agent` subpath to avoid colliding with the existing main-entry export.

- `resolveNow(now?)` injectable-clock helper (`src/time.ts`): normalizes a `Date`, a `() => Date` thunk, or undefined→current time into a concrete `Date`. Exported from the main entry and also from a new pi-free sub-entry `@htwang-contrib/common/time` — the sub-entry loads only `time.ts` and does not pull in the pi-bound modules (e.g. `executeSideCall`) that the main entry re-exports, so pi-free cores (like llm-wiki's `src/core/*`) can use it without breaking their invariant. `package.json` gained an `exports` map (`"."` → existing entry, `"./time"` → `./src/time.ts`); no existing deep-import consumers are affected.
- `runIsolatedSession(ctx, options, signal?)` (`src/agents/isolated-session.ts`): spawns an isolated child agent session — a `DefaultResourceLoader` with `noExtensions` + the caller-supplied `extensionFactories` (and no skills/prompts/themes/context-files), a caller-supplied `systemPrompt`, and `createAgentSession({ tools: [] })` so the child exposes no built-in tools. Runs in the parent `cwd` (identical vault/path resolution), relays the parent session id, wires abort, and returns the child's final assistant text plus a tool-call count and the sub-session file path. Built for the "wiki op as an isolated side-call" pattern (llm-wiki `/wiki-capture` and `/wiki-ingest`) so the heavy LLM work and tool schemas stay out of the main conversation. Exports `IsolatedSessionOptions`/`IsolatedSessionResult`.
- `src/agents/session-links.ts`: child-session link records (`recordChildSessionStarted`/`recordChildSessionFinished`/`childSessionIndexPath`/`ChildSessionLinkRecord`), promoted out of `subagents`. `runIsolatedSession` now writes a `running` record when the child starts and a `done`/`error` record when it finishes, so any isolated child (e.g. llm-wiki `/wiki-capture`/`/wiki-ingest`/`/wiki-lint`/`/wiki-research`) surfaces in the subagents `/view-subagents` picker — running entries show `⏳` and can be opened to tail the live child session.
- `src/events.ts`: `ASK_USER_BLOCKED_EVENT` (`"ask_user_question:blocked"`) + `AskUserBlockedPayload` (`{ active: boolean }`) — cross-extension channel emitted by `ask_user_question` around its questionnaire modal so external state listeners (e.g. `moshi-hooks-extra`) can flip a session from "working" to "blocked". Distinct from the generic `MODAL_ACTIVE_EVENT` boolean (any modal) and the `ASK_USER_PROMPT_EVENT` payload (full question text). Exported from the main entry alongside the other event constants. ([#105](https://github.com/TwIStOy/pi-extensions/issues/105))

### Fixed

- `runIsolatedSession`'s `lastAssistantText`: the message `content` field is now optional and typed as `string | readonly parts[]` in the structural type so it accepts the full `AgentMessage` union (`BashExecutionMessage` carries no `content`; `CustomMessage` carries `string | (TextContent | ImageContent)[]`). String content is skipped. These were latent `tsc --noEmit` errors since the helper was introduced — `npm run check` is biome-only and vitest does not typecheck, so they slipped through.
- `runIsolatedSession`: passing `tools: []` blocked ALL tools in the child (an empty allow-set disables every tool, including extension-registered ones), so isolated children could not call their tool. Replaced with an optional `allowedTools` (omit → all allowed; pass names → only those). Added an optional `model` override so callers can resolve the model themselves.

## [0.4.0] - 2026-07-31

### Added

- File-based extension disable flag: `isExtensionDisabled(id)` reports whether an extension is disabled, resolved from two JSON maps — global `~/.pi/agent/extensions-disabled.json` and project `<cwd>/.pi/extensions-disabled.json`, each `{ "<extensionId>": true }`. Disabled when `true` in either file (union precedence); missing/malformed files and non-`true` values are ignored. Also exports `defaultDisablePaths()` and `resolveDisabledExtensions(paths)`.

## [0.3.1] - 2026-07-30

### Added

- Turn telemetry tracker: `TurnTelemetryTracker` measures TPS, TTFT, and streaming stalls across an agent run by feeding in lifecycle observations (turn/message deltas, tool execution). Only turns with measurable streaming contribute to the aggregated TPS; tool-call turns are clamped to the model's best observed speed. `formatTurnTelemetry` renders a one-line summary with individually gated segments. Injectable `now` for deterministic tests.
- `SessionLifecycle` generation counter that fences stale async callbacks out of the current session — capture a generation before an `await`, re-check it after.
- `fitSegmentsByPriority` joins prioritized segments into a width-bounded line, dropping the lowest-priority segments first and truncating the highest-priority survivor only as a last resort. `measure`/`truncate` are injectable for ANSI-colored or wide (CJK) segments.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

### Added

- Unified file-based logger for extensions: `createLogger(name)` returns a namespaced `Logger` (`debug`/`info`/`warn`/`error`) that appends to `$XDG_STATE_HOME/pi/extensions.log` (default `~/.local/state/pi/extensions.log`). Never touches stdout/stderr (those corrupt the pi TUI); all IO failures are swallowed so diagnostics never break an agent turn. Supports an optional `minLevel` filter. Lines are formatted `ISO [name] LEVEL message`; concurrent appenders below `PIPE_BUF` stay atomic without a lock.
- `resolveStateDir(env, home)` and `getExtensionsLogPath(env)` helpers for resolving the XDG state directory and the shared log path.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- `EDITOR_HINT_EVENT` cross-extension channel (`EditorHintPayload`: `source` / `text` / optional `color`) for transient hint messages rendered inside the input editor's border. Producers emit via `pi.events.emit`; the editor-owning extension subscribes and renders the most recent active hint.
- `chainEditorFactory(current, wrap)` and `getEditorFactoryParent(factory)` for layering custom editor factories on Pi's single editor slot without clobbering each other. Each wrapper records its immediate parent so chains compose regardless of registration order.
