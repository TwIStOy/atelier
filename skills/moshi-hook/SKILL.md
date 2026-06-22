---
name: moshi-hook
description: moshi-hook CLI and wire-protocol reference for the Moshi agent-hooks daemon (pair, serve, install, Easy Pair, diff viewer, cwd-list, context, servers) and the five wire surfaces (local Unix socket, Moshi HTTP, Moshi WebSocket bridge, host gateway HTTP, CLI JSON SSH-preflight). Use when writing or debugging moshi-hook integrations, agent hook configs (Claude, Codex, OpenCode, Gemini, Cursor, Kimi, Qwen, Grok, OMP, Pi), approval/permission flows, the localhost diff gateway, or any code that speaks to moshi-hook serve.
---

# moshi-hook

`moshi-hook` is the agent-hooks daemon for [Moshi](https://getmoshi.app). It bridges coding agents (Claude Code, Codex, OpenCode, Gemini CLI, Cursor, Kimi, Qwen Code, Grok Build, OMP, Pi) to the Moshi iOS/macOS inbox, approvals, Live Activity, Apple Watch, and usage sync.

## Quick start

```bash
moshi-hook pair --token <token>   # 1. pair the agent-hooks daemon
moshi-hook install                # 2. write hook configs for installed agents
moshi-hook serve                  # 3. run the daemon (or `brew services start moshi-hook`)
```

`moshi` is a convenience alias. One directory arg launches a tmux session named after the basename; `moshi diff .` opens the embedded browser diff viewer.

## The five wire surfaces

`moshi-hook` participates in five distinct protocols. Pick the right reference for the surface you are working on:

| # | Surface | Between | See |
|---|---|---|---|
| 1 | Local Unix socket | hooks ↔ daemon | [API §1](references/API.md#1-local-socket) |
| 2 | Moshi HTTP | daemon ↔ Moshi server | [API §2](references/API.md#2-moshi-http-api) |
| 3 | Moshi WebSocket | daemon ↔ Moshi server | [API §3](references/API.md#3-moshi-websocket-bridge) |
| 4 | Host gateway HTTP | Moshi app ↔ `serve` (SSH-forwarded) | [API §4](references/API.md#4-host-gateway-http) |
| 5 | CLI JSON (SSH preflight) | clients ↔ CLI subcommands | [API §5](references/API.md#5-cli-json-ssh-preflight) |

## Approval round-trip

```
agent ─(1)─> hook subprocess ─(2)─> serve (daemon)
                                   ─(3) WSS──> Moshi server ─(4) push─> phone
                                   <─(6) decision ── WSS ── Moshi server
              <─(7)─ approval.response (Unix socket)
agent <─(8)─ exit code / stdout decision
```

## Workflows

### Add Moshi to a new agent

1. Run `moshi-hook install` (writes the managed hook file; non-destructive, skips agents whose config root is missing). Force a set with `--target claude,codex,opencode,gemini,cursor,kimi,qwen,grok`.
2. Confirm coverage by checking the [installed agent files table](references/USAGE.md#installed-agent-files).
3. If your agent has lifecycle events that don't map cleanly, read [HOOKS.md](references/HOOKS.md) before adding a new event category — Moshi deliberately drops most event types.

### Enable tool-event hooks (opt-in)

`install` does **not** wire `PreToolUse`/`PostToolUse` (too chatty: 10–20 per turn). To show a "Running Bash …" row mid-turn, add the entries by hand — see [USAGE.md §tool-event hooks](references/USAGE.md#tool-event-hooks-opt-in).

### Debug pairing / daemon

```bash
moshi-hook status [--json]      # pairing state, paths, WS connection
moshi-hook logs -f              # tail daemon log
moshi-hook context              # what Moshi sees for this shell
moshi-hook cwd-list --json      # recent project dirs Moshi will offer
```

## Where things live

- **Secrets**: macOS Keychain (`app.getmoshi.hook`) by default; `~/.config/moshi/secrets.json` with `--store file`.
- **Socket**: `~/Library/Application Support/Moshi/moshi-hook.sock` (macOS) or `$XDG_RUNTIME_DIR/moshi-hook.sock` (Linux). Override with `MOSHI_SOCKET_PATH`.
- **Gateway**: `127.0.0.1:24543` (loopback-only, no auth) — reached by the phone via SSH local forward. Override with `MOSHI_HOOK_GATEWAY_LISTEN` or `config.toml`.
- **Config**: `~/.config/moshi-hook/config.toml` (override with `MOSHI_HOOK_CONFIG_DIR`).

## References

- [API.md](references/API.md) — full wire-protocol reference (all 5 surfaces).
- [HOOKS.md](references/HOOKS.md) — agent hook event model, per-agent coverage, filter rules.
- [USAGE.md](references/USAGE.md) — complete CLI reference: subcommands, flags, env vars, paths, installed agent files.

> **Source**: Canonical docs live at <https://github.com/rjyo/homebrew-moshi/tree/main/docs> (`api.md`, `hooks.md`, `usage.md`). This skill mirrors that content; check upstream for changes after `moshi-hook update`.
