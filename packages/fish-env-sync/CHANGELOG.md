# Changelog

## [Unreleased]

### Added

- Initial release. Watches `~/.config/fish/fish_variables` (or `$XDG_CONFIG_HOME/fish/`) when the
  active shell is fish, parses exported universal variables (`set -Ux`), and merges them live into
  `process.env` so every spawning tool (bash, `!`/`!!`, grep, glob, ls, committer, subagents, ...)
  sees updated values without restarting pi. No-op when the shell is not fish.
