# Changelog

## [Unreleased]

### Changed

- Now wraps the active editor factory via `chainEditorFactory` (`@htwang-contrib/common`) instead of a private `unwrapBaseFactory`/prior-marker scheme. Behavior is unchanged for the single-wrapper case and is now correct under multi-level editor wrapping. Adds `@htwang-contrib/common` as a dependency.
