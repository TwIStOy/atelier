# Project Context

This is **hawtian-pi-extensions** -- a collection of [pi](https://github.com/earendil-works/pi) coding agent extensions.

## Project Structure

Monorepo with packages under `packages/`:

- `packages/common/` -- Shared utility functions and types used across all extensions (formatting, terminal helpers).
- `packages/zai-coding-plan/` -- Z.AI provider (GLM models) + `zai-quota` command. Reads `ZAI_API_KEY` env var.
- `packages/inference-self-host/` -- Self-hosted proxy provider aggregating models from multiple upstreams (GLM, Qwen, DeepSeek, MiMo, Kimi, MiniMax, etc). Reads `INFERENCE_TWISTOY_API_KEY` env var.
- `packages/protect-secrets/` -- Blocks read-like tool calls targeting files under `/run/agenix`. Uses `unbash` AST parser to analyze bash commands and distinguish secret exposure (e.g. `cat`) from safe capture (e.g. `VAR=$(cat ...) curl`).
- `packages/subagents/` -- In-process subagent extension (WIP). See `docs/subagents/`.
- `packages/statusline/` -- Custom status bar widgets for the pi TUI.
- `packages/tool-display/` -- Tool call rendering adapters for the pi TUI.
- `packages/user-message/` -- User message handling extension.
- `.agents/skills/pi-self-extension/` -- skill with authoritative guidance for building pi extensions (API reference, compat gotchas, validation checklist).

## Subagents

In-process subagent extension (parallel and background runs, no extra `pi` subprocess). Same design docs as the rest of the repo: [docs/subagents/DESIGN.md](docs/subagents/DESIGN.md), [docs/subagents/STEPS.md](docs/subagents/STEPS.md). Package overview and `~/.agent/subagents/settings.json`: [packages/subagents/README.md](packages/subagents/README.md).

## Architecture

- Each extension is a TypeScript file exporting a default function receiving `ExtensionAPI`.
- Extensions register providers via `pi.registerProvider()` and commands via `pi.registerCommand()`.
- No build step -- pi loads `.ts` files directly.
- Root `tsconfig.json` uses project references pointing at each package's own `tsconfig.json`.
- ESM (`"type": "module"` in root `package.json`). Use `.ts` extensions in imports.
- `packages/common` is the shared library (`@htwang-contrib/common`) consumed by other packages.

## Commands

No build/lint scripts configured. Typecheck with:

```bash
npx tsc --build
```

Run tests with:

```bash
npm test
```

## Conventions

- No comments in code unless explicitly requested.
- The `pi-self-extension` skill should be loaded when creating or modifying extensions.
- **Always run `npm run format` after every file change** to keep code style consistent.

## Tool Naming

- Use `snake_case` for tool names (the identifier used in code and API calls).
- Use `CamelCase` for display names (shown in terminal UI, logs, and user-facing output).
