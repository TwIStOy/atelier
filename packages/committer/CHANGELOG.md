# Changelog

## [Unreleased]

## [0.5.0] - 2026-08-12

### Fixed

- `/commit` now runs all git operations at the repository root (`git rev-parse --show-toplevel`) instead of pi's cwd — previously, running pi from a subdirectory made grouped mode fail with `fatal: pathspec ... did not match any files`, because diff paths are repo-root-relative while `git add`/`git reset` resolved them against the subdirectory.
- `/commit` grouped mode no longer fails with an opaque `Command failed: git commit -m ...` when the model groups a file that exists in the repo but has no changes — group files are now intersected with the actual changed-file list (dropping hallucinated paths and duplicate assignments), and each group verifies it staged something before committing. Git subprocess errors now include stdout/stderr so the underlying git message (e.g. "no changes added to commit") is visible. Multi-line error messages render as wrapped lines inside the overlay instead of breaking the box layout.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.3.1] - 2026-07-30

### Fixed

- Killing in-flight git commands when the `/commit` overlay is dismissed (Esc) — previously only the LLM side-call honored the abort signal, so staging/diff/commit subprocesses kept running after dismiss.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
