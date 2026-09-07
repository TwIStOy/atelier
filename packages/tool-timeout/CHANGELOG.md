# Changelog

## [Unreleased]

### Added

- Initial `tool-timeout` extension. Enforces a configurable wall-clock cap on `bash` tool calls via a `tool_call` hook that mutates the call's `timeout` argument in place: calls without a timeout get the cap as their timeout, calls requesting more are clamped down, and calls at or below the cap pass through unchanged. Because the mutation feeds pi's built-in bash tool (which kills the process group on expiry), the cap is enforced by real cancellation, not just a wrapper race. Config: `maxTimeoutSeconds` (number, default `3600` = 1 hour, `0` disables the cap and restores pi's stock no-default-timeout behavior), surfaced through `/config` (`extension-config-ui`).
