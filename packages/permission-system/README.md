# @htwang-contrib/permission-system

A permission-gate extension for the [pi](https://github.com/earendil-works/pi-mono)
coding agent. Pi ships with **no built-in sandbox**; this extension adds
allow / ask / deny gates over the built-in tools (`read`, `write`, `edit`,
`bash`) using a **tree-sitter-bash AST** for correct command analysis (not regex
or string matching).

It gates four built-in tools and is designed to be the single `tool_call`
authority in a pi session (see [coexistence](#coexistence-with-protect-secrets)
below).

## Install

In a pi workspace, add to the root `package.json`:

```json
{
  "pi": {
    "extensions": ["packages/permission-system"]
  }
}
```

## How it works

On every `tool_call` event, a five-gate pipeline runs in order and the first
blocking decision short-circuits:

1. **path** — cross-cutting `path` surface on path-bearing tools (`read`,
   `write`, `edit`, `find`, `grep`, `ls`). Protects `.env` and `~/.ssh` by
   default.
2. **external_directory** — guards against a path-bearing tool reaching outside
   the working directory.
3. **bash-path** — the same `path` surface, but over every path token a bash
   command references (parsed from the AST, `cd`-aware).
4. **bash-external_directory** — working-directory boundary over bash tokens.
5. **tool** — per-tool / bash-command surface (the catch-all: `bash: "ask"`).

For bash, the command is parsed **once** via `BashProgram.parse` and shared
across gates 3–5. Each gate returns `allow` / `ask` / `deny` (or `null` if it
does not apply); `deny` blocks, `ask` prompts, `allow` proceeds.

- `deny` → the tool call is blocked with the rule's reason.
- `ask` → a confirmation dialog (`ctx.ui.confirm`) is shown. Headless sessions
  (`ctx.hasUI === false`, e.g. print/json mode) **fail closed**: `ask` resolves
  to `deny`, never silently allowing.
- `allow` → the call proceeds.

## Configuration

Configuration is a JSONC file (comments allowed), validated by a zod schema.
Project config overrides global (deep-merged). See
[`docs/permission-system/CONFIG.md`](../../docs/permission-system/CONFIG.md)
for the full reference.

### Locations

- **Global**: `~/.pi/agent/extensions/permission-system/config.json`
  (honors `PI_CODING_AGENT_DIR`)
- **Project**: `<cwd>/.pi/extensions/permission-system/config.json`

### Default policy

With no config file at all, the dev-friendly defaults below are baked in:

| Surface | Default |
| --- | --- |
| `read` | `allow` |
| `write`, `edit`, `bash` | `ask` |
| `path` | `*.env`, `*.env.*`, `~/.ssh/*` → `deny`; else `allow` |
| `external_directory` | `ask` outside cwd |

### Example

```jsonc
{
  "permission": {
    "read": "allow",
    "write": "ask",
    "edit": "ask",
    "bash": { "*": "ask", "git *": "allow", "npm test": "allow" },
    "path": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "~/.ssh/*": "deny",
      "/run/agenix/*": "deny"
    },
    "external_directory": { "*": "ask" }
  }
}
```

Wildcard patterns are OpenCode-style (`*` matches across `/`, last-match-wins,
`~` / `$HOME` expansion). Bash keys use subcommand-prefix matching
(`git status` matches `git *`).

## Coexistence with protect-secrets

`protect-secrets` is an older, narrower extension that also hooks `tool_call`
to block agenix-managed paths. This extension's `path` gate subsumes it
(the default `path` policy denies `~/.ssh/*` and `*.env`, and you can add
`/run/agenix/*` → `deny` as in the example above). Having both active causes
double-prompting. Remove `protect-secrets` from `pi.extensions` when enabling
this one. (See `docs/permission-system/RESEARCH.md` §10 D4.)

## Design references

- [`docs/permission-system/RESEARCH.md`](../../docs/permission-system/RESEARCH.md) —
  design doc: pi's `tool_call` hook, the four-layer gate composition, and the
  locked decisions (§10 D1–D4).
- [`docs/permission-system/IMPLEMENTATION-PLAN.md`](../../docs/permission-system/IMPLEMENTATION-PLAN.md) —
  build order and per-step notes.
