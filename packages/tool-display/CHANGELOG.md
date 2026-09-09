# Changelog

## [Unreleased]

### Added

- Consecutive read-only tool calls now collapse into a single grok-style aggregate line ([#145](https://github.com/TwIStOy/pi-extensions/issues/145)). Runs of two or more collapsed `grep` / `glob` / `ls` / `read` widgets render as `  ❙  ◈ Searched N patterns, Read N files, …` — per-type count phrases merged in first-appearance order and joined with `, `; the first member (group leader) draws the line and the rest render empty. Status follows the group: any `isError` member turns the rail and bullet red, any still-partial member swaps the bullet for a spinner and the type's phrase for its progressive form (`Searching…` / `Reading…` / `Listing…` / `Matching…`), otherwise green. Grouping is recomputed from the chat sibling list on every render: assistant/user blocks, other tools, and expanded widgets break the run, zero-line siblings are skipped, and leader election stays idempotent across streaming and session restore. Single read-only calls keep their normal `◆` line, and the aggregate line ignores left clicks for now, so hovering never swaps its bullet for the `›` expand affordance (expansion interaction lands with the sub-line list issue). Oversized summaries truncate to the terminal width via the shared rail renderer.
- Collapsed tool widgets now show a hover affordance in fullscreen mode: hovering a finished, collapsed tool call replaces the leading `◆` status diamond with `›` (color preserved), signaling click-to-expand; expanded widgets always keep `◆`. Hover is tracked by the patched `ToolExecutionComponent.handleMouse` on `move` events (a module-level singleton so only one widget is hovered at a time), and cleared by `Container`/`Editor` prototype patches that claim otherwise-unhandled `move`/`wheel` events when a tool was hovered — covering the cursor moving onto transcript text, blank areas, or the editor. Requires all-motion mouse tracking, so it is inactive under tmux/Zellij/GNU Screen where pi only enables button-motion tracking.
- `apply_patch` tool display adapter: the Codex-style patch tool (registered by `@htwang-contrib/apply-patch` for OpenAI GPT models) now renders in the repo's Edit/Write style. The header shows `ApplyPatch <path>` (accent, `+N more` for multi-file patches); the collapsed line is `└ patch [i/n] +N -M unified|side-by-side · F files [change bar]` with a `✗ N failed` marker on failed hunks (header icon also turns red); the expanded view renders per-file unified diffs through the same `delta` pipeline as Edit, with `├`/`└` per-file headers for multi-file patches and a `✗` failure list. Falls back to parsing the raw patch text for counts while the call is still streaming. The delta rendering helpers (`renderWithDelta`, `renderChangeBar`, `resolveIsSplit`) moved from `edit.ts` to `adapters/shared.ts`, and `generateUnifiedDiff` now comes from `@htwang-contrib/common`.

### Changed

- All tool call lines (header, collapsed content, expanded content) now render through the shared rail column renderer from `@htwang-contrib/common` (`renderRailLines`, landed for #143): rail glyph at column 2, status bullet at column 5, body at column 7. Single-line calls keep an empty rail; multi-line blocks draw a `┃` rail on every continuation row with the bullet only on the first. The rail and bullet take the status color (green success, red error, plain while spinning); the hover affordance swaps the `◆` bullet for `›` as before ([#144](https://github.com/TwIStOy/pi-extensions/issues/144)).
- The `│   ` header continuation prefix and the four-space `INDENT` content indent are retired; continuation and content lines are now rail body rows aligned under the first body column. `Subagent`/`workflow` task rows dropped their `├`/`└` tree branches and render as plain rail continuation rows; the same applies to memory/journal expanded content, which no longer draws its own `│ ` bars ([#144](https://github.com/TwIStOy/pi-extensions/issues/144)).
- `ToolDisplayAdapter` width parameters (`formatCallHeader` / `formatCollapsedContent` / `formatExpandedContent`) and the `ContentRenderer` callbacks now receive the rail body width (`toolRailBodyWidth(width)`: terminal width minus 7) instead of the full terminal width; adapters self-truncate against that budget and `renderRailLines` still applies a final ANSI-aware truncation, so terminals at or below the prefix width no longer produce "exceeds terminal width" lines. The elapsed-time timer now consumes the first body line's budget instead of the old icon prefix ([#144](https://github.com/TwIStOy/pi-extensions/issues/144)).
- `bash` tool calls now render as a header-only widget when collapsed: the `└ N lines` footer line is gone. Instead, when the header has room, a dim `· N lines` output-line count is appended to the end of the header (after the command or `in <cwd>` suffix; dropped entirely when the header already fills the width). `ToolDisplayAdapter.formatCallHeader` gained an optional trailing `output` parameter that `renderToolCall` now passes through, so adapters can surface output-derived info in the header.
- Todo tool calls now render as a header-only widget with no collapsed output line: the collapsed body (`└ Updated #5`-style echoes of the tool result) carried no information beyond the header. The old single `todo` adapter was replaced by per-tool adapters for the split todo tools (`todo_create` / `todo_update` / `todo_list` / `todo_get` / `todo_delete` / `todo_clear`), each rendering its own header (e.g. `TodoUpdate [completed] #5 <subject>`) via a shared `createTodoAdapter(toolName)` factory; the legacy `todoAdapter` export was removed.
- Collapsed tool summaries now sit flush left, aligned under the status icon. The generic collapsed summary (`└ N lines — <key> to expand`, used by tools without a display adapter such as `todo_update`) no longer prefixes a four-space indent, matching the existing read/edit/grep adapter convention.
- `ask_user_question` no longer renders a collapsed `└ N questions` line; its collapsed view is the header only. The `askUserQuestionCollapsed` adapter-gating clause in `renderToolCall` was removed together with it.
- `bash` calls with a `description` now lead with it: the header is a single-line `Bash <description> in <cwd>` (description in accent) and the command is hidden from the collapsed view, surfacing as a muted `$ <command>` block at the top of the expanded view, above the output. Calls without a description keep the previous width-wrapping `Bash <command> in <cwd>` header.
- Tool call blocks now glue into one contiguous group regardless of turn boundaries or render path. The patched `ToolExecutionComponent.render` previously omitted the blank separator line only for adapter-rendered blocks whose immediate previous chat sibling was another tool component, resolved once and cached; tools falling back to pi's stock renderer kept the stock leading `Spacer(1)`, and an invisible (zero-line) sibling between two tools broke the grouping. The previous-sibling lookup now runs on every render, skips zero-line siblings (e.g. assistant turns with no visible content), and the stock-renderer fallback path strips its leading blank line the same way, so consecutive tool widgets always render flush while a tool group still separates from non-tool content with one blank line.

### Fixed

- Adapter-rendered tool blocks are click-expandable again in fullscreen mode. pi's per-block mouse expansion wraps renderer output in `MouseRegion`s inside `ToolExecutionComponent`, but the patched `render` bypasses that tree: `edit` (the only `renderShell: "self"` tool) gates `handleMouse` on `selfRenderHeight`, which only the stock `render` updates, so clicks never toggled; default-shell tools only toggled when the stale child heights happened to cover the clicked line. The patch now also overrides `handleMouse`: unhandled left clicks on a finished adapter-rendered block toggle `setExpanded`, matching the stock `createResultRegion` semantics (nested regions and OSC 8 links still win).

### Removed

- `prefixLine` (dead helper from the retired line-prefix system) is no longer exported from `./format.ts` ([#144](https://github.com/TwIStOy/pi-extensions/issues/144)).

## [0.5.0] - 2026-08-12

### Changed

- Multi-line tool call headers now prefix continuation lines with a tree gutter `│` instead of plain indentation, visually connecting the header to the collapsed `└ N lines` footer. This covers multi-line `Bash` commands, wrapped `Todo` subjects, and wrapped generic tool args (the generic header no longer adds its own extra indent on continuation lines).
- The extension now only activates in TUI mode. All TUI-specific setup (config item registration, `ToolExecutionComponent` render patching, theme capture) is deferred to `session_start` and guarded by `ctx.mode === "tui"`, so running under `--mode rpc`/`json`/`print` no longer patches the component prototype or registers config items. The cross-extension `tool-display:register`/`tool-display:ready` event bus stays active in every mode so adapter registration keeps working.

### Added

- `workflow` tool display adapter: the `Workflow` tool row now matches the Read/Bash/Subagent styling. The header shows the workflow's `meta.name` (parsed from the script with the shared acorn parser via `@htwang-contrib/workflow/script`, falling back to the first script line) plus live `settled/total agents` stats. While the run is in flight the collapsed view renders per-agent rows (`├`/`└` branches, spinner/✓/✗/◌/– status glyphs, tool-call counts, error details) from the run snapshot in `details.workflow`; once finished it collapses to the standard truncated output preview (tail lines + "more lines" expand hint). The expanded view renders the full script with syntax-highlighted line numbers, followed by the full output summary. `tool-call-display.ts` now treats `workflow` like `subagent` for adapter gating (collapsed rows render from details even before text output exists) and derives the header status icon from `details.ok`.

### Fixed

- Errored tool calls (e.g. an `Edit`/`Write` blocked by read-tracker) now render their collapsed view as a single `└ <error message>` line, matching the style of normal collapsed returns, instead of an indented `✖`-prefixed reason plus an adapter marker. The error reason is the collapsed summary; the adapter's full output (the diff for `Edit`/`Write`) moves to the expanded view, which now appends `adapter.formatExpandedContent` after the reason. Previously the error-reason branch of `renderToolCall` was mutually exclusive with the adapter branch and indented the reason by `INDENT`, so a rejected `Edit` either lost its `└ diff` line entirely or floated the reason four spaces to the right of where the `└` marker sits.
- The patched `ToolExecutionComponent.render` now prepends the blank separator line that the stock component renders via its leading `Spacer(1)` child. The override bypassed the container's children entirely, so tool call rows were glued directly to the preceding assistant text or compact thinking block with no empty line in between. Consecutive tool calls from the same assistant message are exempt: when the previous chat sibling is another `ToolExecutionComponent`, the separator is omitted so parallel tool calls render as one glued group.
- Multi-task `Subagent` tool calls no longer crash pi on narrow terminals. The per-task and batch summary rows in the collapsed tool display now truncate the task description against the terminal width (width- and ANSI-aware via `truncateToWidth`/`visibleWidth`) and apply a safety-net truncation so no rendered row can exceed the terminal width. Previously the description was capped at a fixed 56 characters and the composed row was never bounded, producing lines wider than the terminal and triggering `Rendered line exceeds terminal width`.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.5] - 2026-07-14

### Added

- Tool calls now show an elapsed-time label between the status icon and the tool name. Durations under 3s render as milliseconds (e.g. `123 ms`), 3s-90s as seconds with two decimals (e.g. `4.20s`), and 90s+ as `m:ss` (e.g. `1:30`). The timer ticks live while running and freezes at the final duration once the call completes.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Breaking Changes

- Removed the `bashCommandDisplayLength` config item from the Tool Display extension. It only controlled the floor for command *truncation*, and the Bash header now wraps the command onto continuation lines instead of truncating, so the knob no longer has any effect ([#11](https://github.com/TwIStOy/pi-extensions/issues/11)).

### Fixed

- The Bash tool header now wraps long commands onto continuation lines instead of truncating them with an ellipsis, so the full command stays visible in every state (partial, collapsed, expanded, errored). Continuation lines are aligned under the command start, and the description and `in <cwd>` suffix remain visible ([#11](https://github.com/TwIStOy/pi-extensions/issues/11)).
- Fixed the error icon being repeated on every wrapped line of a tool's error reason when the tool call failed and was expanded. The icon now appears only on the first line, with continuation lines aligned by padding ([#9](https://github.com/TwIStOy/pi-extensions/issues/9)).
- Fixed the Bash tool header truncating the command at a fixed point and dropping the `in <cwd>` suffix. The command now fills the available terminal width and is truncated cleanly so the description and working-directory suffix stay visible ([#8](https://github.com/TwIStOy/pi-extensions/issues/8)).
