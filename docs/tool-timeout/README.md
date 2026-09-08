# tool-timeout

Enforces a configurable maximum wall-clock timeout on local tool calls. Without it, a `bash` call that omits `timeout` runs with **no bound at all** — a hung process, a stuck network mount, or an infinite loop keeps the agent stalled forever.

Package: `packages/tool-timeout` (`@htwang-contrib/tool-timeout`).

## How it works

A `tool_call` event handler (the hook that runs before execution, whose `event.input` is mutable) rewrites the `timeout` argument of every `bash` call:

| Model requests | Effective timeout |
| --- | --- |
| nothing | the cap (default 3600 s) |
| `timeout` above the cap | clamped to the cap |
| `timeout` at or below the cap | unchanged |
| invalid `timeout` (0, negative, NaN) | the cap (instead of pi's argument error) |

The rewritten value flows into whatever `bash` tool is actually registered — pi's built-in local bash or a re-registered one (e.g. gondolin-sandbox) — because the mutation happens on the call input, not on a wrapped tool. Pi's bash implementation kills the process group when the timeout expires, so the cap is real cancellation.

### Exempt rules

Some commands must never be interrupted — killing them mid-run wastes hours of work (e.g. a long `ocr review` pass that would have to restart from scratch). `exemptRules` is an array of `{ "tool", "pattern" }` objects; when the tool name matches and **any string argument** contains the pattern (for bash: the `command`), the call runs with **no timeout at all**:

- the cap is not applied, and
- a model-requested `timeout` argument is removed.

The pattern is a plain case-sensitive substring (commas, `=`, quotes etc. are all literal). Entries whose `tool`/`pattern` is missing or empty are ignored. Rules are absolute: they strip the timeout even when `maxTimeoutSeconds` is `0`.

This key is **not** registered in `/config` (the config UI cannot edit arrays); edit `extensions.json` directly.

## Config

`maxTimeoutSeconds` is registered via `registerConfigItems`, editable through `/config` (see `extension-config-ui`). Both keys persist to `~/.config/pi/extensions.json` under `tool-timeout`:

```json
{
  "tool-timeout": {
    "maxTimeoutSeconds": 3600,
    "exemptRules": [{ "tool": "bash", "pattern": "ocr review" }]
  }
}
```

| Key                 | Type    | Default | Meaning                                                                    |
| ------------------- | ------- | ------- | -------------------------------------------------------------------------- |
| `maxTimeoutSeconds` | number  | `3600`  | Cap in seconds. `0` disables the cap entirely (pi stock: no default bound). |
| `exemptRules`       | array   | `[]`    | `{ tool, pattern }` rules; matched calls run with no timeout (see above). JSON-only, not in `/config`. |

Master kill-switch: disable the extension via `extension-disable` (`tool-timeout`).

## Scope and non-goals

Only `bash` is covered — it is the only local tool with a native per-call `timeout` argument, so the cap can be enforced by the tool itself (process-group kill). Other built-ins (`read`/`write`/`edit`/`grep`/`find`/`ls`) complete in milliseconds and expose no timeout knob; clamping arguments they do not have would be a no-op, and racing their execution with a timer would not actually stop the underlying work. Tools that use a differently-named timeout field or different units (e.g. `subagent`'s `timeout_ms` in milliseconds) are deliberately left alone.
