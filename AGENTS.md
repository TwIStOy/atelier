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
- `packages/extra-tools/` -- Extra LLM tools `grep`, `glob`, and `ls` (prompt bullets in co-located `.txt`; `grep`/`glob` use ripgrep). Same-named tools override pi built-ins when this extension loads.
- `packages/ask-user-question/` -- Structured `ask_user_question` tool (port in progress). Phase 0: `/auq-phase0` probes `ctx.ui.custom` in the **editor slot** only; see `docs/ask-user-question/`.
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

## Porting upstream code — reuse this repo first (重要)

When migrating or adapting an extension from another project (for example `rpiv-ask-user-question` under `docs/ask-user-question/`):

- **Do not** paste large slabs of upstream code by default. Implement against **this** monorepo: package layout, `peerDependencies`, ESM + `.ts` imports, existing extension patterns, and how Pi is wired here.
- **Reuse before copy**: prefer `@htwang-contrib/common`, patterns from sibling packages (`subagents`, `tool-display`, `user-message`, etc.), and shared types/helpers already in the tree.
- **Promote to `packages/common/`**: if you introduce logic that **two or more** extensions could reasonably share, add it to `packages/common` and export it from that package’s public surface instead of duplicating it inside a single extension.
- Upstream remains a **behavior and API reference**, not a vendor drop. The step-by-step checklist lives in [docs/ask-user-question/EXECUTION-STEPS.md](docs/ask-user-question/EXECUTION-STEPS.md); architecture notes in [docs/ask-user-question/PORT-DESIGN.md](docs/ask-user-question/PORT-DESIGN.md).

**Agents: treat the bullets above as mandatory for any port or large adaptation, not optional guidance.**
