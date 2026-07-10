# permission-system — Configuration Reference

`@htwang-contrib/permission-system` reads a JSONC config file (line `//` and
block `/* */` comments allowed), validated by a zod schema. Project config
overrides global, deep-merged per surface.

## File locations

| Scope | Path |
| --- | --- |
| Global | `~/.pi/agent/extensions/permission-system/config.json` (honors `PI_CODING_AGENT_DIR`) |
| Project | `<cwd>/.pi/extensions/permission-system/config.json` |

Project overrides global. If neither file exists, the
[default policy](#default-policy) applies.

## Structure

```jsonc
{
  "permission": {
    "<surface>": "<state>" | { "<pattern>": "<state>", ... },
    ...
  },
  "permissionReviewLog": true   // optional, default true
}
```

- **`<surface>`** — one of `read`, `write`, `edit`, `bash`, `find`, `grep`,
  `ls`, `path`, `external_directory`, or the universal `*`.
- **`<state>`** — `"allow"`, `"ask"`, or `"deny"`.
- A surface may be a bare string (applies to every call on that surface) or a
  pattern map (last-match-wins).
- **`permissionReviewLog`** — top-level boolean (default `true`); when on,
  every decision is appended to a JSONL audit log (see
  [Decision audit log](#decision-audit-log)).

## Surfaces

| Surface | Applies to | What it gates |
| --- | --- | --- |
| `*` | everything | Universal fallback when no other surface matches. |
| `read`, `write`, `edit` | those tools | Per-tool default. |
| `bash` | the `bash` tool | Command matching (subcommand prefix). |
| `find`, `grep`, `ls` | those tools | Per-tool default (read-only path tools). |
| `path` (cross-cutting) | `read`/`write`/`edit`/`find`/`grep`/`ls` **and** bash path tokens | Filesystem paths referenced anywhere. Runs **before** per-tool gates. |
| `external_directory` | path-bearing tools **and** bash | Whether a path/command reaches outside the working directory. |

## Default policy

Baked in when no config file is present. A config file is deep-merged over
these (config wins on conflict):

```jsonc
{
  "permission": {
    "*": "ask",
    "read": "allow",
    "write": "ask",
    "edit": "ask",
    "bash": "ask",
    "path": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "~/.ssh/*": "deny"
    },
    "external_directory": { "*": "ask" }
  }
}
```

## Pattern matching

- **Path patterns** (the `path` and `external_directory` surfaces) use
  OpenCode-style wildcards: `*` matches across `/`, `?` matches one segment,
  `~` / `$HOME` expand to the home directory, and matching is last-wins.
- **Tool/per-tool patterns** match against the surface name itself, so a bare
  `"read": "ask"` (equivalent to `read: { "*": "ask" }`) matches any read.
- **Bash patterns** match the **subcommand prefix**, not the whole command:
  `git status` matches the rule `git *`; `npm test` matches `npm test`. This is
  derived from a command-arity table, not naive whitespace splitting.

## Gate order

On every `tool_call`, five gates run in order; the first blocking result
short-circuits:

1. `path` — cross-cutting path surface (tools)
2. `external_directory` — working-directory boundary (tools)
3. `path` — cross-cutting path surface (bash path tokens)
4. `external_directory` — working-directory boundary (bash tokens)
5. `tool` — per-tool / bash-command surface

For bash, the command is parsed **once** via tree-sitter-bash and shared across
gates 3–5.

## State semantics

- `allow` — proceed (no prompt).
- `ask` — show a permission dialog with three choices: **Allow once**, **Allow
  always (session)**, **Deny**. **Headless sessions** (print/json mode,
  `ctx.hasUI === false`) fail closed: `ask` resolves to `deny`. The command is
  never silently allowed.
- `deny` — block the tool call with the rule's reason.

## Session approvals (remember a decision)

When you pick **Allow always (session)** on an `ask` prompt, the decision is
remembered for the rest of the current pi session: later calls matching the
same key skip the dialog entirely. This is per-session only — remembered
approvals are cleared on session start/reload and are never written to disk.

The key a remembered approval matches on is derived from what triggered the
prompt:

| Trigger | Key | Example |
| --- | --- | --- |
| bash command | `command:<prefix>` (bash-arity subcommand) | approving `npm test` later covers `npm test --verbose` |
| filesystem path | `path:<path>` | the exact path token |
| whole tool | `tool:<toolName>` | any call of that tool |

**Allow once** does not remember — the next matching call prompts again.

## Decision audit log

Every permission decision is appended as one JSONL line to
`~/.pi/agent/extensions/permission-system/logs/review.jsonl` (under the
global config dir; honors `PI_CODING_AGENT_DIR`). Each record:

```jsonc
{ "timestamp": "2026-07-10T00:00:00.000Z", "tool": "bash",
  "action": "execute", "decision": "ask-allowed",
  "trigger": "command:npm test" }
```

The `decision` field records the disposition:

| decision | meaning |
| --- | --- |
| `allow` | a gate allowed it (no prompt) |
| `ask-allowed` | the user picked Allow once / Allow always (session) |
| `ask-denied` | the user picked Deny |
| `ask-headless-denied` | ask in headless mode → fail-closed deny |
| `deny` | a gate denied it (rule-based block) |

Set `"permissionReviewLog": false` in the config to disable it. Write errors
are swallowed — logging never breaks an agent turn.

## Permissive-bash fallback warning

If the top-level `*: "allow"` is set with no explicit `bash` policy, bash
commands would silently inherit `allow`. The loader detects this footgun and
emits a warning to the extension log (`~/.local/state/pi/extensions.log`):

> Permission config sets a permissive top-level `*: 'allow'` with no `'bash'`
> `'*'` policy, so bash commands silently inherit `'allow'`. Set an explicit
> `'bash'` policy (e.g. `"bash": { "*": "ask" }`) to gate bash commands.

Fix it by setting an explicit `bash` surface.

## Recipes

### Allow git, gate everything else

```jsonc
{
  "permission": {
    "bash": { "*": "ask", "git *": "allow" }
  }
}
```

### Lock down secrets

```jsonc
{
  "permission": {
    "path": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "~/.ssh/*": "deny",
      "~/.aws/*": "deny",
      "/run/agenix/*": "deny"
    }
  }
}
```

### Allow reads everywhere, ask for writes, deny bash outright in CI

```jsonc
{
  "permission": {
    "read": "allow",
    "write": "ask",
    "edit": "ask",
    "bash": "deny"
  }
}
```
