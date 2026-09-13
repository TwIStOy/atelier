# htw-producer

A pi extension that pushes live session state to the
[`htw`](https://github.com/TwIStOy/htw) agent-sessions daemon,
following the [Producer HTTP Protocol](https://github.com/TwIStOy/htw/blob/main/docs/agent-sessions/producer-protocol.md).

Each pi session becomes one `htw` **Session**. The extension is a **Producer**:
it listens to pi lifecycle events, assembles a full-state **Report** snapshot,
and POSTs it to the daemon. This is a **side channel** — it must never affect
the agent's main flow.

## How it maps pi → Report

| Report field | Source |
| --- | --- |
| `id` | `ctx.sessionManager.getSessionId()` (stable across reloads) |
| `cwd` | `ctx.cwd` |
| `model` | `ctx.model.name` (falls back to `id`) |
| `project` | `git rev-parse --git-common-dir` (cached per cwd; basename fallback) |
| `worktree` | `git rev-parse --show-toplevel` / first `git worktree list` entry / current branch |
| `status` | derived from events (see below) |
| `context` | `ctx.getContextUsage()` → `{ percent, used, window }` |
| `diff` | best-effort cumulative line counts from `edit` / `write` tool args |
| `tool` | the running tool from `tool_execution_start` (args sanitized to small identifying fields) |
| `cost` | sum of `usage.cost.total` over assistant messages in the branch |
| `pid` | `process.pid` (lets the daemon reap the session if pi dies) |
| `tmux_pane` | `$TMUX_PANE` when present |
| `started_at` | first `session_start` for this session id (Unix epoch seconds) |
| `agent` | always `"pi"` (the harness label) |
| `title` | `getSessionName()` if set, else the shared LLM-generated session title (see below), else the first user prompt (single-lined, ≤80 chars); omitted when none is available |

### Status derivation

| pi event | status |
| --- | --- |
| `session_start` | `idle` (mint id, start heartbeat) |
| `agent_start` / `tool_execution_start` | `working` |
| `agent_end` / `tool_execution_end` (tool cleared) | `idle` |
| `MODAL_ACTIVE_EVENT` (`ask_user_question` open) | `waiting` |
| `session_shutdown` | `ended` (final report, then stop heartbeat) |

A heartbeat POST runs every 5s (the protocol's freshness contract) so the
session stays `Live` on the dashboard even between events.

## Silent failure

The daemon may not be running. Every POST is fire-and-forget with a 1.5s
timeout; any error (connection refused, timeout, non-204) is logged at debug
level to the shared extensions log and swallowed. The whole `push` path is
wrapped in `try/catch` so a buggy report build or a stale `ctx` can never
throw back into pi's event loop. The heartbeat timer is `unref()`'d so it
never keeps the process alive on its own.

If the `ended` POST on shutdown races with process exit and is lost, the
daemon still reaps the session because we report `pid` — its periodic
`kill(pid, 0)` sweep removes it.

## Configuration

Surfaced in the `/config` popup under **HTW Producer** (persists to
`~/.config/pi/extensions.json`):

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch; when off, no reports are sent |
| `host` | `127.0.0.1` | Daemon bind address |
| `port` | `7482` | Daemon port |

## Session title

The title is the shared session title from `@htwang-contrib/common`'s
session-title service — the same LLM-generated value herdr shows on its tab,
requested **once per session** from the first user prompt (side-call, never
on the agent's main flow). The producer:

- requests it at `session_start` (a resumed session may already carry its
  first prompt on the branch), `before_agent_start` (prompt captured directly
  from the event) and `agent_end` (cheap retry point);
- emits a `title_changed` event the moment the generated title latches — the
  daemon folds the envelope's remembered `title` attribute without touching
  the session's status;
- reports the chain `sessionName` > generated title > truncated first prompt
  on every snapshot/event envelope, so the daemon has a bootstrap label even
  before the generated title lands.

Generation is configured in `/config` under the shared **Session Title**
section (enabled/model), not under HTW Producer.

## Scope notes

- Reports run in **all** pi modes, including headless/rpc. Short-lived
  subagent sessions therefore appear briefly; each carries its own `pid` and
  is reaped by the daemon when it exits.
- `diff` counts are a best-effort approximation from tool args (lines in
  `edit` `oldText`/`newText` and `write` `content`); they are not a true
  working-tree diff.
