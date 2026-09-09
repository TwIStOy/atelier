# recap — Idle Session Recap

Port of the `recap` feature from [`pi-spark`](https://github.com/earendil-works/pi-spark) (`src/features/recap`), adapted to this monorepo's conventions.

## What it does

When a TUI session has been idle — no agent activity and no editor input — for a configurable timeout (default 5 minutes), the extension makes a one-shot LLM side-call over the serialized session transcript and renders a 1-2 sentence recap in a widget below the editor:

```
Recap: You asked to fix the login bug; the auth check was extracted and tests pass.
```

The recap clears as soon as activity resumes (new input, agent turn, compaction, tree switch) and regenerates the next time the session goes idle. Each generated recap is also appended to the session file as a `recap` custom entry (model + usage + content), so usage is auditable after the fact.

The `/recap` command forces a recap on demand.

## Idle detection

`IdleListener` (`src/idle.ts`) polls a state hash every second:

```
idle:${ctx.isIdle()};editor:${ctx.ui.getEditorText()}
```

While watching, any hash change (agent stops/starts, user types) restarts the idle timer, so a user typing a long prompt never triggers a recap mid-composition. The state machine is `active → watching → idle`:

- **wake** events (reset to active): `input`, `user_bash`, `agent_start`, `session_before_compact`, `session_before_tree`
- **watch** events (start/refresh watching): `agent_settled`, `session_compact`, `session_tree`
- On resumed/forked sessions the listener starts watching immediately at `session_start`, so a resumed session left open still produces a recap.

The minimum idle timeout is 5 seconds; configured values below that are clamped.

## Model selection

Follows the same pattern as `herdr`: the `/config` **Recap Model** item stores a `provider/model` pattern resolved with `resolveModel` from `@htwang-contrib/common`. Empty (default) falls back to the current session model. The side-call goes through `executeSideCall`, which handles API key resolution, aborts, and error mapping.

## Configuration (`/config` → Recap)

| Item | Default | Description |
| --- | --- | --- |
| Enable Recap | on | Master switch; when off, no idle listener or side-calls |
| Recap Model | (session default) | Model used for the recap side-call |
| Idle Timeout (seconds) | 300 | How long the session must stay idle before a recap is generated |

Config is persisted through the shared ConfigItem mechanism (`@htwang-contrib/common`), not a package-local config file.

## Differences from pi-spark

- Config via ConfigItem/`/config` instead of `spark.json` + zod schemas.
- Model resolution via the shared `resolveModel` pattern matcher instead of explicit `provider`/`model`/`thinkingLevel` fields; thinking is left at the model default rather than forced off.
- The side-call goes through `executeSideCall`; output length is guarded by parsing/clipping (400 chars) instead of a `maxTokens` cap.
- Transcript assembly uses `branchToMessages` + `serializeConversation` from this repo's `@htwang-contrib/common`.

## Files

| File | Purpose |
| --- | --- |
| `src/index.ts` | Entry point; event wiring, `/recap` command, session lifecycle |
| `src/idle.ts` | `IdleListener` state-hash idle detector |
| `src/manager.ts` | Prompt building, side-call, widget updates, `recap` session entries |
| `src/widget.ts` | Loading/text widget renderers (`ctx.ui.setWidget`) |
| `src/config.ts` | ConfigItem registration and model resolution |
