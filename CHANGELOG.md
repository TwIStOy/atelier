# Changelog

## [Unreleased]

## [0.6.1] - 2026-09-01

### Added

- `/land` prompt template: land the current branch from any state — resume detection (uncommitted / pushed / PR open), then commit, push, `gh pr create`, watch CI, rebase on conflicts or base-branch moves, and wait (polling, no busy-loop) until the human merges. Reusable in half-finished sessions; agents never merge or enable auto-merge.

### Changed

- `/implement-many`: pane agents now land their work unattended. After `/implement` they commit and push non-interactively, open a PR via `gh pr create`, watch CI (`gh pr checks --watch`), rebase onto the base branch on conflicts or required updates (`push --force-with-lease` on their own branch only), and keep the PR green until the user merges it — agents never merge or enable auto-merge. The contract is injected at seed time via `--append-system-prompt <file>`.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- `experience` extension scaffold (empty entry point reserved for upcoming experience-related tooling).
- `experience` `hide-models`: hide providers/models from the model picker via `/hide-models add|remove|reset|help` or `/config` -> experience; patches `ModelRegistry.prototype.getAvailable`/`getAll` against persisted rules, reads live config so `/config` edits apply immediately, `reset` temporarily unpatches at runtime.
- `scripts/worktree-merged.sh`: report which git worktrees' branches have been merged into a mainline and can be deleted safely; supports `--json` for machine-readable output and `--prune` for removal (see `docs/scripts/worktree-merged.md`).

---
