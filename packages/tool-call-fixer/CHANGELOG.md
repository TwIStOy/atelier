# Changelog

## [Unreleased]

### Added

- Initial skeleton for the `tool-call-fixer` extension. Registers a `tool_call` handler that mutates `event.input` in place to adjust suspicious arguments before the tool executes. Core is a pure `applyStrategies(toolName, input, config, strategies)` plus a `STRATEGIES` registry in `src/strategies/` (empty, ready for individual strategy files). Config surface (`enabled`, `notifyOnStrategy`) via `@htwang-contrib/common`.
