# Changelog

## [Unreleased]

### Changed

- `web_search` tries the next configured provider after any failure, not only rate limits, and stops at the first provider that returns. Cancelling the tool aborts the chain. If every provider fails, the error lists each one. The provider chain (`searchProviderChain`) is split into per-attempt helpers.
- Providers share `providers/http.ts` helpers (`throwIfMissingApiKey`, `requestJson`, `requireContent`), and the GitHub interceptor wraps `gh api` calls through one `ghQuery` helper — identical error messages, less duplicated plumbing.
- Split the most complex functions (`fetchGitHub`, `generateCloneContent`, `fetchViaApi`, `parseGitHubUrl`, tool `execute` handlers, provider `fetch` paths, `createSearchProvider`) into small single-purpose helpers to clear all `fallow health` complexity findings; behavior and public APIs unchanged.

### Fixed

- `web_search` failure text and `details.error` now include the `error.cause` chain. Node's `fetch` reports only `fetch failed` on `.message`, so the tool row had no actionable reason.

### Removed

- Dead exports: `GITHUB_TOKEN_ENV_VAR`, `GitHubInterceptor.reset()`, and the unused `GITHUB_INTERCEPTOR_DEFAULTS` / `parseGitHubUrl` / `ResolvedGitHubOptions` re-exports from the interceptors barrel. Unused `@earendil-works/pi-tui` peer/dev dependency declarations (no imports).

## [0.7.0] - 2026-10-30

### Added

- The extension now self-registers into the shared child-extension registry (`registerChildExtensionFactory` from `@htwang-contrib/common`), so `subagent` / `workflow` child sessions get `web_search` / `web_fetch` whenever web-tools is loaded in the parent session (previously hardcoded into the `subagents` child factory list).
- Aggregate rules for `web_fetch` and `web_search`, so consecutive calls collapse into one verb-group summary line (e.g. `Fetched 2 pages, Searched 1 query`) in tool-display.
- `web_search` / `web_fetch` declare read-only open-world annotations. `web_search` declares an `outputSchema` and returns `{ query, backend, results }` as `structuredContent`, so codemode scripts receive typed results instead of text.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.6] - 2026-07-16

### Added

- AnySearch provider (`search` + `fetch`). Connects to the AnySearch MCP API at `https://api.anysearch.com/mcp`; API key is optional (anonymous access allowed, lower rate limits). Configure via env var `ANYSEARCH_API_KEY` or the `/config` UI.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

### Added

- Emits an `extension loaded` log line when the extension initializes.

### Changed

- The `gh` CLI availability hint now uses the shared logger (`createLogger("web-tools")`, `logger.warn`) instead of `console.error`, which corrupts the pi TUI.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
