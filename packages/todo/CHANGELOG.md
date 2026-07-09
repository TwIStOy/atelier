# Changelog

## [Unreleased]

## [0.2.3] - 2026-07-09

### Breaking Changes

- Split the single `todo` tool into six per-action tools: `todo_create`, `todo_update`, `todo_list`, `todo_get`, `todo_delete`, `todo_clear`. Each tool only exposes the fields its action needs, with required fields enforced at the schema level (`subject` for create, `id` for update/get/delete). The unified `todo` tool and its `action` parameter are removed. The underlying state reducer, transition validation, response envelope, `/todos` command, and overlay widget are unchanged.

### Changed

- Status indicators in the overlay widget and `/todos` command now use Nerd Font v3 Material Design checkbox icons instead of plain Unicode: `pending` = `nf-md-checkbox_blank_outline`, `in_progress` = `nf-md-checkbox_intermediate`, `completed` = `nf-md-checkbox_marked` (replacing `○` / `◐` / `✓`). Requires a Nerd Font v3 in the terminal; non-Nerd fonts render missing-glyph boxes.
- `replayFromBranch` and the overlay `tool_execution_end` refresh now match any `todo_<action>` tool name via `isTodoToolName()`, which also accepts the legacy `todo` name so existing sessions keep restoring after upgrade.
- `todo update` with only an `id` (and no mutable field) now defaults `status` to `in_progress` instead of erroring with "update requires at least one mutable field". Models frequently emitted bare `update {id}` (and list-only noise like `includeDeleted: false`) when intending to start work, which previously failed and could spam hundreds of identical errors in a single turn. Explicit mutable fields, transition validation, and all other error paths (`id required`, `#id not found`, illegal transitions) are unchanged.

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Fixed

- Fixed a type error that broke `tsc --build`: the `call` test helper now returns a typed result (`TodoCallResult`) instead of `unknown`, so accessing `.details` / `.content` no longer requires `as TaskDetails` casts.
