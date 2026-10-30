# Extension Disable Flag

Disable any extension without uninstalling it. Each extension checks a disable flag at load time and, when disabled, registers nothing — no tools, no commands, no event handlers, no providers. The extension is effectively dormant.

This is a **file-based** mechanism, separate from pi's installed-extensions list and from the `/config` panel. There is no UI for it; you toggle it by editing two JSON files.

## The two config files

| Scope | Path | Purpose |
| --- | --- | --- |
| Global | `~/.pi/agent/extensions-disabled.json` | Applies to every project. (Honors `PI_CODING_AGENT_DIR`.) |
| Project | `<cwd>/.pi/extensions-disabled.json` | Applies only to the project you launch pi from. |

Both paths mirror pi's own config conventions (`~/.pi/agent/` for global settings, `<cwd>/.pi/` for project settings).

## Schema

Each file is a map from extension id to a boolean. An extension is disabled when its value is `true`.

```json
{
  "committer": true,
  "voice-input": true,
  "subagents": true
}
```

- `true` → disabled (skips loading).
- `false`, or absent → enabled (loads normally).
- Only literal `true` counts. Strings, numbers, `null`, and arrays are ignored.
- A missing file, or a file that fails to parse, is treated as empty (nothing disabled).

## Precedence — union

An extension is disabled if it is `true` in **either** file. A global disable therefore stays a kill switch, and a project file can additionally disable extensions for that project only. The project file **cannot** re-enable something the global file has disabled (`false` in the project file does not override `true` in the global file).

## Finding the extension id

The id is the extension's **package directory name** (the short, unscoped name). It is the same key the extension uses for its own config under `/config`. The current set:

```
agents-mirror
ask-user-question
auto-compact
btw
committer
context-usage
experience
extension-config-ui
extra-tools
goal
magpie
memory
message-queue
moshi-hooks-extra
protect-secrets
read-tracker
statusline
subagents
todo
tool-call-fixer
tool-display
toori
truncate-outputs
user-input-history
user-message
voice-input
web-tools
working-indicator
zai-coding-plan
```

## Applying a change

1. Edit one or both JSON files.
2. Reload: run `/reload` inside pi, or restart pi.

The flag is read when the extension loads, so a running session needs a reload to pick up the change.

> Note: disabling `extension-config-ui` removes the `/config` command. You can still re-enable it (or any extension) by editing the JSON files directly — they are always read regardless of UI state.

## For extension authors

The gate lives in the extension's default factory, using the shared helper from `@htwang-contrib/common`:

```ts
import { isExtensionDisabled } from "@htwang-contrib/common";

export default function (pi: ExtensionAPI): void {
  if (isExtensionDisabled("my-extension")) return;
  // ...registration
}
```

`isExtensionDisabled(id)` reads the two files (via pi's `getAgentDir()` and `CONFIG_DIR_NAME`) and returns whether `id` is disabled under union precedence. The lower-level building blocks are also exported for testing:

- `defaultDisablePaths()` → `{ globalPath, projectPath }` for the current process.
- `resolveDisabledExtensions(paths)` → the `Set<string>` of ids disabled across both files.
