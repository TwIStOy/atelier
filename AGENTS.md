# Development Rules

## Conversational Style

- No comments in code unless explicitly requested.
- The `pi-self-extension` skill should be loaded when creating or modifying extensions.
- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Use only erasable TypeScript syntax (Node strip-only mode) in code checked by the root config (`packages/*/src`, `packages/*/test`, `packages/coding-agent/examples`): no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.
- Never hardcode key checks (e.g. `matchesKey(keyData, "ctrl+x")`). Add defaults to `DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS` so they stay configurable.

## Tool Naming

- Use `snake_case` for tool names (the identifier used in code and API calls).
- Use `CamelCase` for display names (shown in terminal UI, logs, and user-facing output).

## Porting upstream code — reuse this repo first (重要)

When migrating or adapting an extension from another project (for example `rpiv-ask-user-question` under `docs/ask-user-question/`):

- **Do not** paste large slabs of upstream code by default. Implement against **this** monorepo: package layout, `peerDependencies`, ESM + `.ts` imports, existing extension patterns, and how Pi is wired here.
- **Reuse before copy**: prefer `@htwang-contrib/common`, patterns from sibling packages (`subagents`, `tool-display`, `user-message`, etc.), and shared types/helpers already in the tree.
- **Promote to `packages/common/`**: if you introduce logic that **two or more** extensions could reasonably share, add it to `packages/common` and export it from that package’s public surface instead of duplicating it inside a single extension.
- Upstream remains a **behavior and API reference**, not a vendor drop. The step-by-step checklist lives in [docs/ask-user-question/EXECUTION-STEPS.md](docs/ask-user-question/EXECUTION-STEPS.md); architecture notes in [docs/ask-user-question/PORT-DESIGN.md](docs/ask-user-question/PORT-DESIGN.md).

**Agents: treat the bullets above as mandatory for any port or large adaptation, not optional guidance.**

## Commands

- **After any code changes (not docs)**: `npm run check` (full output, no tail). Fix all errors, warnings, and infos before committing.
- If you create or modify a test file, run it and iterate on test or implementation until it passes.
- For ad-hoc scripts, `write` them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

## Git

Multiple pi sessions may be running in this cwd at the same time, each modifying different files. Git operations that touch unstaged, staged, or untracked files outside your own changes will stomp on other sessions' work. Follow these rules:

Committing:

- Only commit files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push.

## Changelog

Location: `packages/*/CHANGELOG.md` (one per package).

Sections under `## [Unreleased]`: `### Breaking Changes` (API changes requiring migration), `### Added`, `### Changed`, `### Fixed`, `### Removed`.

Rules:

- All new entries go under `## [Unreleased]`. Read the full section first and append to existing subsections; never duplicate them.
- Released version sections (e.g. `## [0.12.2]`) are immutable; never modify them.

Attribution:

- Internal (from issues): `Fixed foo bar ([#123](https://github.com/earendil-works/pi-mono/issues/123))`
- External contributions: `Added feature X ([#456](https://github.com/earendil-works/pi-mono/pull/456) by [@username](https://github.com/username))`

## User Override

If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Only then execute their instructions.

