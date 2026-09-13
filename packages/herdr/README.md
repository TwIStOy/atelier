# @htwang-contrib/herdr

Update the herdr tab title from inside pi.

This extension **only takes effect when pi is running inside herdr** — it
no-ops entirely when the `HERDR_ENV=1` / `HERDR_PANE_ID` environment variables
that herdr injects into managed panes are absent.

## What it does

1. **Session summary as the tab title** — When pi's pane is the focused pane,
   the herdr tab is renamed to a short LLM-generated summary of the session's
   **first user prompt**. The first prompt states the session's intent and is
   stable, so the title is generated **once per session** (not on every turn).
2. **State icon prefix** — The title is prefixed with an icon that reflects the
   agent's current state:

   | State   | Icon | Meaning                                          |
   | ------- | :--: | ------------------------------------------------ |
   | running |  ⏺   | The agent turn is in progress.                   |
   | waiting |  ❓  | The agent is blocked on an `ask_user_question`.  |
   | idle    |  ✓   | The agent finished its turn and awaits the next. |

## Detection

`HERDR_ENV=1` and `HERDR_PANE_ID` (both injected by herdr) gate activation.
The tab to rename is resolved via `herdr pane get <pane_id>`'s `tab_id` field,
falling back to the `HERDR_TAB_ID` env var when herdr injects it (not all
builds do). `HERDR_BIN_PATH` (falling back to `herdr` on `PATH`) selects the
CLI binary used to query/control herdr.

Note: on current herdr releases `pane get` prints bare JSON and does **not**
accept a `--json` flag, so the client does not pass it. The tab being renamed
is always **our own** tab (resolved from our pane), so its title is updated
unconditionally — including when our pane is momentarily unfocused (e.g. an
LLM side-call resolving after the user switched panes). Otherwise a title
change landing while unfocused would be lost forever.

## Configuration

Surfaced via the `/config` command: the tab-title toggle lives under the
**Pi-Herdr** extension; the title generation settings are shared under the
**Session Title** section (see below).

| Key                     | Default | Description                                                         |
| ----------------------- | ------- | ------------------------------------------------------------------- |
| Pi-Herdr `enabled`      | `true`  | Turn tab-title updates on/off.                                      |
| Session Title `enabled` | `true`  | Turn LLM title generation on/off (shared with other consumers).      |
| Session Title `model`   | `""`    | Model used to generate the title. Empty = current session model.     |

## Shared title generation

The title comes from `@htwang-contrib/common`'s session-title service: a
process-wide singleton that generates the title once per session from the
first user prompt (LLM side-call via `executeSideCall` over the prompt
captured from `before_agent_start`, falling back to the session branch for
resumed sessions). herdr is one consumer of that title — other extensions
(e.g. `htw-producer`, which reports it to the htw daemon) share the same
generated value instead of re-requesting it.

## How it works

State is derived from pi events, mirroring the pattern already used by
`moshi-hooks-extra`:

- `session_start` → generate the title from the branch (a resumed session
  may already have the first prompt); then **idle**.
- `before_agent_start` → **running**; the first user prompt is captured
  directly from `event.prompt` (synchronously, before it's persisted to the
  branch) and the title is generated immediately — no need to wait for the
  turn to finish.
- `ask_user_question` payload (`ASK_USER_PROMPT_EVENT`) + modal-open
  (`MODAL_ACTIVE_EVENT`) → **waiting**; use the question text as the body.
- Modal close → back to **running**.
- `agent_end` → **idle** (also a safety retry in case the prompt was missed
  on earlier events).
- `session_shutdown` → **restore** the user's original tab label (or its tab
  number) so the tab title doesn't get stuck on our summary after pi exits.

On session start the extension snapshots the tab's original label (via
`herdr tab get`) before its first overwrite, and snaps it back on shutdown. If
the tab already shows one of our own titles (a `⏺`/`❓`/`✓` prefix, e.g. left
over from a previous run), it falls back to the tab's `number` instead.

## Files

- `herdr-client.ts` — env detection + thin herdr CLI client (pane get / tab
  get / tab rename). Pure JSON parsing is split out for unit tests.
- `state.ts` — `AgentState`, icons, title builder, ask-question summarizer.
- `config.ts` — the herdr tab-title toggle.
- `index.ts` — entry point: gates on herdr env, registers config items, wires
  events, debounces renders behind an active-pane guard.
