# Changelog

## [Unreleased]

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
