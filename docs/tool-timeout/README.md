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

## Config

Registered via `registerConfigItems`, editable through `/config` (see `extension-config-ui`), persisted to `~/.config/pi/extensions.json` under `tool-timeout`:

| Key                 | Type   | Default | Meaning                                                                    |
| ------------------- | ------ | ------- | -------------------------------------------------------------------------- |
| `maxTimeoutSeconds` | number | `3600`  | Cap in seconds. `0` disables the cap entirely (pi stock: no default bound). |

Master kill-switch: disable the extension via `extension-disable` (`tool-timeout`).

## Scope and non-goals

Only `bash` is covered — it is the only local tool with a native per-call `timeout` argument, so the cap can be enforced by the tool itself (process-group kill). Other built-ins (`read`/`write`/`edit`/`grep`/`find`/`ls`) complete in milliseconds and expose no timeout knob; clamping arguments they do not have would be a no-op, and racing their execution with a timer would not actually stop the underlying work. Tools that use a differently-named timeout field or different units (e.g. `subagent`'s `timeout_ms` in milliseconds) are deliberately left alone.
