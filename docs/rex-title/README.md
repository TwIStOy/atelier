# Rex Title

Rex Title summarizes the current Pi session and sets its native session title. In Rex, Pi's terminal title and Program Status reports provide the pane and tab presentation without changing persistent Rex resource labels. The title refreshes automatically after every agent run started by a user message, or manually through `/rex-title`.

## Usage

Automatic refresh runs in the interactive TUI after each user-message turn completes. Every refresh reads all user messages from the active session branch in chronological order, including earlier refinements and corrections; assistant and tool output are excluded. Long transcripts retain every request, with long individual requests clipped around their head and tail to keep the side-call bounded.

A newer refresh cancels an unfinished older one so stale output cannot replace a newer title. Automatic failures leave the existing title unchanged and are recorded in the extension log.

To force a refresh, run:

```text
/rex-title
```

The manual command waits for the active agent turn to finish before reading the branch. It does not add a message to the main conversation.

The generated title uses the conversation's primary language, is collapsed to one line, and is limited to 60 Unicode characters. A model call times out after 60 seconds. Concurrent manual invocations supersede earlier ones.

## Model configuration

Open `/config` and select **Rex Title → Title Model** to choose a model independently of the session model. The select lists available chat models from Pi's model registry and reads the current registry whenever its options are requested, so asynchronously registered provider catalogs such as Magpie are included.

The default **(session default)** option uses the session's active model. Selecting another model applies it only to title side-calls; it does not change the session model used for agent responses. If a configured model is no longer available, title generation reports an error instead of silently using a different model.

## Native title integration

The extension applies generated titles through:

```typescript
pi.setSessionName(title);
```

Pi owns the resulting presentation and lifecycle:

- The session display name is saved in Pi's session metadata and shown in the footer and session selector.
- Pi updates the terminal title to `π - <session name> - <cwd>`.
- Pi's native OSC 7501 Program Status reporter includes the session name as `msg` in `working` and `done` reports.
- Pi clears its Program Status record when the terminal stops, including on exit.

Pi 1.5.0 does not expose the protocol's separate `title=` field through its extension API. The extension deliberately uses the supported session-name path instead of emitting an independent OSC 7501 root record that Pi's reporter could overwrite.

The extension does not call `rex block rename` or `session.set_block_label`. Those APIs change a persistent Rex block label, which is unrelated to Pi's process title lifecycle and remains after Pi exits. Existing explicit Rex block or window labels are left untouched.
