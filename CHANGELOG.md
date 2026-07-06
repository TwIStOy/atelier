# Changelog

## [Unreleased]

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- `experience` extension scaffold (empty entry point reserved for upcoming experience-related tooling).
- `experience` `hide-models`: hide providers/models from the model picker via `/hide-models add|remove|reset|help` or `/config` -> experience; patches `ModelRegistry.prototype.getAvailable`/`getAll` against persisted rules, reads live config so `/config` edits apply immediately, `reset` temporarily unpatches at runtime.
- `scripts/worktree-merged.sh`: report which git worktrees' branches have been merged into a mainline and can be deleted safely; supports `--json` for machine-readable output and `--prune` for removal (see `docs/scripts/worktree-merged.md`).

---
