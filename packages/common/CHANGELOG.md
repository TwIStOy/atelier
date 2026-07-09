# Changelog

## [Unreleased]

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
