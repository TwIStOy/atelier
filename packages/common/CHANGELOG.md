# Changelog

## [Unreleased]

### Added

- `resolveNow(now?)` injectable-clock helper (`src/time.ts`): normalizes a `Date`, a `() => Date` thunk, or undefined→current time into a concrete `Date`. Exported from the main entry and also from a new pi-free sub-entry `@htwang-contrib/common/time` — the sub-entry loads only `time.ts` and does not pull in the pi-bound modules (e.g. `executeSideCall`) that the main entry re-exports, so pi-free cores (like llm-wiki's `src/core/*`) can use it without breaking their invariant. `package.json` gained an `exports` map (`"."` → existing entry, `"./time"` → `./src/time.ts`); no existing deep-import consumers are affected.
- `runIsolatedSession(ctx, options, signal?)` (`src/isolated-session.ts`): spawns an isolated child agent session — a `DefaultResourceLoader` with `noExtensions` + the caller-supplied `extensionFactories` (and no skills/prompts/themes/context-files), a caller-supplied `systemPrompt`, and `createAgentSession({ tools: [] })` so the child exposes no built-in tools. Runs in the parent `cwd` (identical vault/path resolution), relays the parent session id, wires abort, and returns the child's final assistant text plus a tool-call count and the sub-session file path. Built for the "wiki op as an isolated side-call" pattern (llm-wiki `/wiki-capture` and `/wiki-ingest`) so the heavy LLM work and tool schemas stay out of the main conversation. Exports `IsolatedSessionOptions`/`IsolatedSessionResult`.
- `src/session-links.ts`: child-session link records (`recordChildSessionStarted`/`recordChildSessionFinished`/`childSessionIndexPath`/`ChildSessionLinkRecord`), promoted out of `subagents`. `runIsolatedSession` now writes a `running` record when the child starts and a `done`/`error` record when it finishes, so any isolated child (e.g. llm-wiki `/wiki-capture`/`/wiki-ingest`/`/wiki-lint`/`/wiki-research`) surfaces in the subagents `/view-subagents` picker — running entries show `⏳` and can be opened to tail the live child session.

### Fixed

- `runIsolatedSession`'s `lastAssistantText`: the message `content` field is now optional in the structural type so it accepts the full `AgentMessage` union (some members, e.g. `BashExecutionMessage`, carry no `content`). This was a latent `tsc --noEmit` error since the helper was introduced — `npm run check` is biome-only and vitest does not typecheck, so it slipped through.

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
