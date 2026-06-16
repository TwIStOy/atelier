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
- `packages/todo/` -- 移植自 rpiv-todo 的任务管理扩展,提供 `todo` 工具(create/update/list/get/delete/clear)+ `/todos` 命令 + aboveEditor overlay widget,状态通过 session branch replay 持久化。参考 `docs/todo/`.
- `packages/user-message/` -- User message handling extension.
- `packages/voice-input/` -- 语音听写扩展:spawn 跨平台录音(ffmpeg/parecord/sox)+ 云端 OpenAI 兼容 STT(mimo-v2.5 chat 多模态)+ 追加到输入框。命令 `/voice-toggle`/`/voice-cancel`/`/voice-status`,setWidget 浮层状态,密钥脱敏。**可选 VAD 分段**(`vad.enabled`):Silero v5 经 `onnxruntime-web` WASM 流式逐帧检测,按停顿自动切段 + 增量追加(`OrderedAppender` 保序);模型 `models/silero_vad.onnx` 随包分发,VAD 模式 Linux 统一用 ffmpeg(parecord 不支持 stdout)。参考 `docs/pi-vox/DESIGN-VAD.md`.
- `packages/user-input-history/` -- Persistent prompt history in `history-store.ts` (`XDG_CACHE_HOME/pi/user-input-history.json`, locked multi-process merge); Ctrl+R panel in `interactive-search.ts` ranks lines with **skim** (`sk --filter`, stdin = history; falls back to built-in fuzzy if `sk` missing); extension entry `index.ts` clears built-in `ctrl+r` on `app.session.rename` via in-memory `getKeybindings().setUserBindings` only (does not edit `keybindings.json`).
- `packages/extra-tools/` -- Extra LLM tools `grep`, `glob`, and `ls` (prompt bullets in co-located `.txt`; `grep`/`glob` use ripgrep). Same-named tools override pi built-ins when this extension loads.
- `packages/ask-user-question/` -- `ask_user_question` tool + rpiv-parity **`state/`** / **`view/`** (editor-slot `ctx.ui.custom` only); dev commands **`/auq-phase0`** / **`/auq-phase1`** / **`/auq-phase2`** in **`demo.ts`** (delete with demos when port is done); see `docs/ask-user-question/`.
- `packages/context-usage/` -- **`/context`** command: estimated context-window usage in the below-editor widget; **Esc** clears it. Adapted from dotpi `context-usage`.
- `packages/goal/` -- Persistent goal tracking (Codex-style goal mode): `/goal` command, `create_goal`/`update_goal`/`get_goal` tools, automatic continuation prompts, token budget control, statusline integration. See `docs/goal/`.
- `packages/btw/` -- `/btw` command: one-off side questions answered in a bottom overlay, never entering the main conversation. See `docs/btw/`.
- `packages/memory/` -- Memory/journal tools (`memory-*`, `journal-*`) + `/self-improve` and `/reorganize-memory` commands for persistent knowledge and reflection.
- `packages/committer/` -- `/commit` command: generate conventional commits from staged/unstaged changes using an LLM side-call.
- `packages/extension-config-ui/` -- `/config` command: browse and edit extension configurations in a TUI popup.
- `prompts/` -- Project-level prompt templates bundled with this repo (registered via `pi.prompts` in root `package.json`).
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
- `prompts/` holds project-local prompt templates; packages can declare their own via `pi.prompts` in `package.json`.

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
