# agents-mirror

Inject nested `AGENTS.md` into the agent's context from an **external mirror directory** that mirrors the project's structure but holds only `AGENTS.md` files — plus the project's own nested `AGENTS.md`.

Inspired by [`pi-nested-agents-md`](https://github.com/code-yeongyu/pi-nested-agents-md), with one key difference: the per-directory guidance does **not** have to live inside the codebase. You keep an external "agents store" with the same directory layout as your project, containing only `AGENTS.md` files. When the agent reads `src/components/Button.tsx`, this extension looks up `src/AGENTS.md` and `src/components/AGENTS.md` in **both** the project and the configured mirror, and appends them to the read result.

## Why?

You may want directory-scoped agent guidance (component conventions in `src/components/`, API conventions in `src/api/`) without committing `AGENTS.md` files into every subdirectory of the repo. A mirror keeps the guidance out of the codebase while preserving the 1:1 path relationship so the extension can find it.

## How the mapping works

A global JSON file (default `~/.config/pi/agents-mirror.json`) maps each project root to its mirror root:

```json
{
  "/home/you/project-a": "/home/you/agents-store/project-a",
  "/home/you/project-b": "/home/you/agents-store/project-b"
}
```

When pi starts in `/home/you/project-a`, the extension resolves the mirror root for that cwd (by `realpath` equality, so symlinks match). On every `read` tool result it walks:

1. **In-project** — from the file's directory up to (but excluding) the project root, collecting nested `AGENTS.md`.
2. **In the mirror** — the same relative path under the mirror root, from the file's mirrored directory up to (but excluding) the mirror root, collecting nested `AGENTS.md`.

The project root's `AGENTS.md` is skipped (pi loads it natively), and the mirror root's top-level `AGENTS.md` is skipped too (only nested guidance is injected). Candidates are ordered outermost-first within each source; project files come before mirror files. Per-session deduplication prevents the same directory's `AGENTS.md` from being injected twice.

```
read /home/you/project-a/src/components/Button.tsx
       project tree                      mirror tree
       project-a/                        agents-store/project-a/
       ├── AGENTS.md   (skipped)         ├── AGENTS.md        (skipped)
       └── src/                          └── src/
           ├── AGENTS.md ✓ (project)         ├── AGENTS.md ✓ (mirror)
           └── components/                   └── components/
               ├── AGENTS.md ✓ (project)         ├── AGENTS.md ✓ (mirror)
               └── Button.tsx  (agent reads)     └── (no code files needed)
```

## Configuration

The mapping file path is editable via the `/config` UI under **Agents Mirror → Mapping File Path**, persisted to `~/.config/pi/extensions.json`. Defaults to `~/.config/pi/agents-mirror.json`.

**Agents Mirror → Inline Chat Entry** (default on) controls whether each successful injection renders a compact row in the chat body. Turn it off if you only want the footer status + widget.

The mapping file itself is a plain JSON object of `{ "absoluteProjectRoot": "absoluteMirrorRoot" }`.

## Commands & flags

| Entry | Effect |
|---|---|
| `/agents-mirror` | Toggle the context widget (lists every injected `AGENTS.md` this session) and dump cache state to the session log. |
| `/agents-mirror reload` | Clear the in-memory mapping cache and re-resolve the mirror for the current cwd (use after editing the mapping file). |
| `pi --no-agents-mirror` | Disable the extension for the session. |

## TUI

- **Inline chat entry** (`agents-mirror:injected`): on each successful injection, a compact dim row renders in the chat body right after the `read` result, e.g. `↳ agents-mirror · injected 2 (1 project, 1 mirror)`. Expand it to see the per-file paths (`[mirror]` tag for mirror-sourced, `(truncated)` when the byte cap was hit). This entry is **not** sent to the LLM — the injected text already reaches the model via the `read` result, so there is no token duplication. Toggle via the **Inline Chat Entry** setting.
- **Status line** (`ext:agents-mirror:status`): shows the running count of injected directories this session; a trailing warning glyph appears if any `AGENTS.md` failed to read. Rendered by whatever owns the footer — in this repo, enable statusline's **Show Extension Statuses** setting (default on) so it surfaces `ctx.ui.setStatus` values.
- **Widget** (`ext:agents-mirror:widget`): hidden by default; `/agents-mirror` toggles it. Lists injected files with a `[mirror]` tag for mirror-sourced entries and a `(truncated)` marker when the byte cap was hit.

In headless / RPC / print mode (`ctx.hasUI === false`) all UI calls are skipped; injection still occurs.

## Defaults

| Knob | Default |
|---|---|
| File names searched | `AGENTS.md` |
| Max bytes per `AGENTS.md` | 32 KiB |
| Max bytes per read | 128 KiB total across all injected files |
| Mapping file | `~/.config/pi/agents-mirror.json` |

## Relation to pi-nested-agents-md

This extension reuses the walk-up + per-session dedup + code-point-safe truncation approach from `pi-nested-agents-md`, and adds:

- An **external mirror** source resolved from a global config file.
- A **combined** two-source walk (project + mirror), each outermost-first.
- Mirror discovery is **lexical** (based on the file's relative path), so the mirror never needs to contain the code files themselves — only the `AGENTS.md` files at the matching subpaths.
