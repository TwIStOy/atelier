# Changelog

## [Unreleased]

### Added

- New `canvas` extension: a session-scoped HTTP server (bound to `0.0.0.0`, reachable from LAN and Tailscale) that serves agent-published HTML pages. Tools: `canvas_publish` (upsert a full HTML document at `/p/<name>`), `canvas_delete`, `canvas_list`. Served pages get an injected base stylesheet (shared design tokens exposed as `--canvas-*` CSS variables) and an SSE snippet so browsers auto-reload on republish; the index page at `/` lists all pages and auto-reloads on any change. Pages persist to a configurable directory (default `~/.pi/agent/canvas/`). Port is configurable (default 7700) with automatic fallback to the next free port when occupied.
- Multi-session support: the page store is disk-backed with no in-memory cache (reads rescan the shared directory), writes are atomic (temp file + rename, last-writer-wins per page), and an `fs.watch` on the pages directory broadcasts SSE change events for pages written or deleted by other pi sessions (own writes are suppressed to avoid double reloads).
- Lazy activation: only the `/canvas` command is registered at startup. The first `/canvas` invocation registers the `canvas_*` tools into the running session and injects the canvas guidance (`src/guidance.md`) into conversation history via `sendMessage` with `deliverAs: "nextTurn"` (skill-style expansion: one-shot, attached to the next user prompt, no turn triggered). Until then the extension has zero effect on the context — no tools, no skill, no guidance. Text trailing the command (`/canvas <prompt>`) is forwarded to the agent as a normal user prompt (`sendUserMessage`, `followUp` delivery while the agent is streaming).
- `src/guidance.md`: design and authoring guidance adapted from Cursor's canvas skill (when to publish, self-contained HTML rules, forbidden slop patterns, plot labeling, pre-delivery self-check, URL-link convention).
