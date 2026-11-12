# Rex Title

Rex Title summarizes the current Pi session and applies the generated title to the originating Rex pane. It refreshes automatically after every agent run started by a user message, or manually through `/rex-title`.

## Usage

Automatic refresh runs in the interactive TUI after each user-message turn completes. Every refresh reads all user messages from the active session branch in chronological order, including earlier refinements and corrections; assistant and tool output are excluded. Long transcripts retain every request, with long individual requests clipped around their head and tail to keep the side-call bounded.

A newer refresh cancels an unfinished older one so stale output cannot replace a newer title. Automatic failures leave the existing pane title unchanged and are recorded in the extension log.

To force a refresh, run:

```text
/rex-title
```

The manual command waits for the active agent turn to finish before reading the branch. It does not add a message to the main conversation.

The generated title uses the conversation's primary language, is collapsed to one line, and is limited to 60 Unicode characters. A model call times out after 60 seconds. Concurrent manual invocations supersede earlier ones.

## Model configuration

Open `/config` and select **Rex Title → Title Model** to choose a model independently of the session model. The select lists available chat models from Pi's model registry and reads the current registry whenever its options are requested, so asynchronously registered provider catalogs such as Magpie are included.

The default **(session default)** option uses the session's active model. Selecting another model applies it only to title side-calls; it does not change the session model used for agent responses. If a configured model is no longer available, title generation reports an error instead of silently using a different model.

## Rex integration

Rex calls a terminal pane's underlying resource a **block** and a tab a **window**. A tab displays the label of its active block unless the window has an explicit label. Renaming only Pi's block therefore updates the pane header and lets the tab follow whichever block is active without pinning a separate tab title.

The extension resolves Pi's originating block through `rex whoami --json`, using Pi's inherited `REX_SESSION` and `REX_BLOCK` environment and requiring a local Unix-socket endpoint. It pins the returned `session_id` and `block_id`, so subsequent focus changes cannot redirect the rename.

The title is applied through:

```text
session.set_block_label
```

The CLI equivalent is `rex block rename`. The extension uses the JSON API to target Pi's block explicitly and passes arguments directly without shell interpolation. Rex accepts labels up to 128 characters, trims surrounding whitespace, and rejects control characters. This extension imposes the smaller 60-character display budget before calling Rex.

If another client or the user assigned an explicit window label, the extension leaves it untouched; the tab may therefore continue to show that explicit label instead of the active block's new title.

See Rex's [CLI reference](https://www.superlogical.com/rex/docs/reference/cli) and [server API reference](https://www.superlogical.com/rex/docs/reference/api) for the underlying command and validation rules.
