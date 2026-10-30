# Changelog

## [Unreleased]

### Added

- `/canvas-open [name]` opens the index or an existing page in a new Rex pane on the right while keeping focus in Pi. Uses a dedicated terminal-browser profile and daemon, Kitty animation rendering, and a 30 FPS limit. The executable is configurable through `/config`.
- `canvas_publish` / `canvas_delete` / `canvas_list` declare MCP-style annotations (`canvas_list` read-only; publish/delete destructive and idempotent).

### Fixed

- Concurrent Canvas commands wait for the same HTTP server startup; failed starts can be retried instead of returning an unready server.

### Changed

- The `canvas_publish` display adapter follows the tool-display rail layout migration ([#144](https://github.com/TwIStOy/pi-extensions/issues/144)): expanded content lines no longer carry the four-space indent (they are rail body rows now), width budgets are computed against the adapter body width, and the empty-html marker renders as `└ empty`.

## [0.6.0] - 2026-08-19

### Fixed

- Horizontal bar charts: `xLabel`/`yLabel` now follow the visual axes (previously they were bound to category/value axes, so with `horizontal: true` the category-axis name was rendered at the middle of the vertical axis with a fixed 26px gap and overlapped long category labels). The value-axis name renders at the top-right end; the category-axis name at the top end of the vertical axis with a small gap.
- `/lib/*` files are read from disk per request instead of cached in memory, so wrapper updates take effect on browser refresh without restarting the server.


- New `canvas` extension: a session-scoped HTTP server (bound to `0.0.0.0`, reachable from LAN and Tailscale) that serves agent-published HTML pages. Tools: `canvas_publish` (upsert a full HTML document at `/p/<name>`), `canvas_delete`, `canvas_list`. Served pages get an injected base stylesheet (shared design tokens exposed as `--canvas-*` CSS variables) and an SSE snippet so browsers auto-reload on republish; the index page at `/` lists all pages and auto-reloads on any change. Pages persist to a configurable base directory (default `~/.pi/agent/canvas/`); each pi session writes to its own subdirectory keyed by session id, so canvases never collide across sessions. Port is configurable (default 7700) with automatic fallback to the next free port when occupied.
- Multi-session isolation: each session's pages live in `<pagesDir>/<sessionId>/`. The page store is disk-backed with no in-memory cache (reads rescan on every call), and writes are atomic (temp file + rename, last-writer-wins within a session).
- tool-display integration: `canvas_publish` registers a custom adapter (`src/display.ts`) via the `tool-display:register` event bus channel. The call header shows only the page name (the `html` argument never clutters the header), collapsed view shows the publish URL + html size, and expanding reveals the html body. Adapter uses structural typing — no runtime dependency on `@htwang-contrib/tool-display`.
- Lazy activation: only the `/canvas` command is registered at startup. The first `/canvas` invocation registers the `canvas_*` tools into the running session and injects the canvas guidance (`src/guidance.md`) into conversation history via `sendMessage` with `deliverAs: "nextTurn"` (skill-style expansion: one-shot, attached to the next user prompt, no turn triggered). The injected message is visible in the transcript as a compact one-line marker (custom message renderer for `canvas:guidance`) instead of the full guidance text. Until then the extension has zero effect on the context — no tools, no skill, no guidance. Text trailing the command (`/canvas <prompt>`) is forwarded to the agent as a normal user prompt (`sendUserMessage`, `followUp` delivery while the agent is streaming).
- `src/guidance.md`: design and authoring guidance adapted from Cursor's canvas skill (when to publish, self-contained HTML rules, forbidden slop patterns, plot labeling, pre-delivery self-check, URL-link convention).
- Vendored charting: ECharts 5.6.0 (`src/lib/echarts.min.js`, Apache-2.0) and a thin themed wrapper (`src/lib/canvas.js`, global `PiCanvas`) are served at `/lib/echarts.min.js` and `/lib/canvas.js`. `PiCanvas.lineChart` / `barChart` (stacked/horizontal/normalized) / `pieChart` (donut) take declarative props (categories, series, tones, referenceLines, value prefix/suffix, axis labels, title, source) and render flat, token-colored charts — pages never configure ECharts directly. The base stylesheet now also ships semantic tone tokens (`--canvas-success/warning/danger/info`), a categorical chart palette (`--canvas-series-1..6`), and layout component classes (`.grid`, `.card`, `.stat`, `.pill`, `.callout`, `.chart`).
- Vendored diagrams: Mermaid 11.16.1 (`src/lib/mermaid.min.js`) is served at `/lib/mermaid.min.js`, loaded only on pages that contain diagrams. `PiCanvas.mermaid("#id", { diagram })` maps the page's CSS variables onto Mermaid's `base` theme (node fill, borders, edges, text, categorical `cScale` palette) so diagrams match the design tokens — diagram sources never hardcode colors. Runs at Mermaid's default (strict) security level (HTML/script in node labels is sanitized); on a syntax error the container shows a `.callout-danger` block with the message instead of breaking the page. Render is async (SVG); every diagram renders at a fixed scale so all diagrams share one text size (larger graphs are never shrunk to fit — they scroll horizontally instead), with an optional `maxWidth` (px) to cap the scroll box. `src/guidance.md` documents the load + usage convention.
