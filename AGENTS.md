# Project Context

This is **hawtian-pi-extensions** -- a collection of [pi](https://github.com/earendil-works/pi) coding agent extensions.

## Project Structure

- `extensions/zai-coding-plan/` -- Z.AI provider (GLM models) + `zai-quota` command. Reads `ZAI_API_KEY` env var.
- `extensions/inference-self-host/` -- Self-hosted proxy provider aggregating models from multiple upstreams (GLM, Qwen, DeepSeek, MiMo, Kimi, MiniMax, etc). Reads `INFERENCE_TWISTOY_API_KEY` env var.
- `extensions/protect-secrets/` -- Blocks read-like tool calls targeting files under `/run/agenix`. Uses `unbash` AST parser to analyze bash commands and distinguish secret exposure (e.g. `cat`) from safe capture (e.g. `VAR=$(cat ...) curl`).
- `.agents/skills/pi-self-extension/` -- skill with authoritative guidance for building pi extensions (API reference, compat gotchas, validation checklist).

## Architecture

- Each extension is a TypeScript file exporting a default function receiving `ExtensionAPI`.
- Extensions register providers via `pi.registerProvider()` and commands via `pi.registerCommand()`.
- No build step -- pi loads `.ts` files directly.
- Root `tsconfig.json` uses project references pointing at each extension's own `tsconfig.json`.
- ESM (`"type": "module"` in root `package.json`). Use `.ts` extensions in imports.

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
