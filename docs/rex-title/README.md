# Rex Title

`/rex-title` generates a short title for the current Pi session and applies it to the originating Rex pane.

## Usage

Run:

```text
/rex-title
```

The command waits for the active agent turn to finish, serializes the current session branch, and makes one side-call with the session's active model. It does not add a message to the main conversation or run automatically after agent turns. Run it again after the session changes direction to refresh the title.

The generated title uses the conversation's primary language, is collapsed to one line, and is limited to 60 Unicode characters. A model call times out after 60 seconds. Concurrent invocations and sessions without conversation messages or an active model are rejected with a notification.

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
