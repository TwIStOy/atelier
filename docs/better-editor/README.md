# BetterEditor

`@htwang-contrib/better-editor` owns the main prompt editor. Its entry point is `extensions/better-editor/src/index.ts`.

## Behavior

- A rounded input box with an accent `❯ ` prefix and aligned continuation lines.
- Context usage and session cost in the top-left border, model and thinking level in the top-right border, and the working directory in the bottom border.
- Transient border hints from the shared `EDITOR_HINT_EVENT` channel.
- Persistent prompt history with up/down navigation. Multiline prompts become single lines when browsing with arrows; the stored text retains its original formatting.
- Ctrl+R opens history search, using `sk` for ranking when available and the built-in fuzzy matcher otherwise. Selection fills the editor without submitting it. Ctrl+R is detached from session rename for the current process only.
- While an agent run is active, the first interrupt key press shows `esc again to abort`; a second press within the configured window reaches Pi's abort handler. Autocomplete closes with one press. Idle interrupt behavior is unchanged. The interrupt key follows Pi's `app.interrupt` binding.

History is shared across sessions in `$XDG_CACHE_HOME/pi/user-input-history.json`, falling back to `~/.cache/pi/user-input-history.json`. Writes retain the existing locking and atomic replacement behavior and keep the newest 1000 entries. Input events also record prompts that bypass the editor, including noninteractive prompts.

## Configuration

Open `/config` -> BetterEditor. Settings are stored under the `better-editor` namespace.

| Key | Default | Meaning |
| --- | --- | --- |
| `borderColor` | `dim` | `dim`, `border`, or `thinkingLevel`; bash input retains Pi's bash border color. |
| `doubleEscapeEnabled` | `true` | Require two interrupt presses during an active run. |
| `doubleEscapeDebounceMs` | `600` | Abort confirmation window; the configuration UI allows 200–2000 ms. |

Disable the whole extension with the `better-editor` [disable flag](../extension-disable/README.md). Pi then uses its default editor.

## Migration

The extension consolidates editor rendering from `statusline`, all of `user-input-history`, and `experience/double-escape`.

- Replace standalone `user-input-history` registrations with `extensions/better-editor`.
- Move customized `statusline.borderColor` to `better-editor.borderColor`.
- Move customized `experience.doubleEscapeEnabled` and `experience.doubleEscapeDebounceMs` to the corresponding `better-editor` keys.
- Replace the `user-input-history` disable flag with `better-editor` to disable the consolidated editor. Disabling `statusline` or `experience` no longer disables their former editor behavior.

Old configuration namespaces are not read. The history cache path remains unchanged, so saved prompts require no migration.

`statusline` owns the footer and telemetry. `experience` owns model visibility. `user-message` owns submitted user-message rendering in the transcript.

## Implementation

`BetterEditor` extends Pi's `CustomEditor` and forwards unhandled input to it. One `setEditorComponent` registration installs rendering, history, and interrupt handling together. Session shutdown resets the interrupt timer and releases the shared hint subscription.

The history adapter accesses Pi's private history array to preserve the existing 1000-entry navigation behavior; native `addToHistory` caps navigation at 100. Integration tests exercise navigation through real editor input.

The prompt gutter prepends to complete rendered lines with `paddingX: 0`. Avoid slicing the start of those lines: Pi embeds a zero-width cursor marker there, and prior editor-prefix changes corrupted it in the real terminal. Verify editor rendering against the installed Pi binary as well as unit tests.
