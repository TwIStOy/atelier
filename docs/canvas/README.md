# Canvas

Canvas serves HTML pages published by a Pi agent. Each Pi session has its own page directory and HTTP server. Browsers reload a page when the agent republishes it.

## Commands

- `/canvas [prompt]` enables the publishing tools and starts the server. Optional text goes to the agent as a normal prompt.
- `/canvas-open` opens the page index in a new Rex pane to the right of the current Pi pane.
- `/canvas-open <name>` opens an existing published page directly. Page names are available through argument completion once the server has started.

`/canvas-open` also enables publishing after the preview opens. It keeps keyboard focus in Pi. Each invocation creates a new preview pane; close a preview with `Ctrl+Q`. Publishing a page does not create panes automatically.

## Rex preview requirements

Install [terminal-browser](https://github.com/zenbu-labs/terminal-browser) on the machine running Pi and the Rex server. The Rex client must support Kitty graphics. A remote Rex GUI can display the preview: terminal-browser and Canvas run together on the server host and communicate through `127.0.0.1`.

Pi must inherit both `REX_SESSION` and `REX_BLOCK`, and the Rex CLI must resolve the same session and block through a local Unix socket. `REX_SERVER` alone is insufficient. The command pins that endpoint and block so changes to the focused pane cannot redirect the split. Connections to a Rex server on another machine are rejected because its loopback address would not reach this Canvas server.

In `/config` → **Canvas**, **Terminal Browser** accepts an executable name on Pi's PATH or an absolute executable path. It is not a shell command and does not accept additional arguments. The new browser process receives Pi's PATH so its launcher can resolve dependencies even when the Rex server has a minimal environment. **Port** and **Pages Directory** retain their existing roles.

The preview uses `terminal-browser open --no-merge` with Kitty's `animation` presenter and a 30 FPS limit. Browser profile, config, data, cache and logs are stored under `~/.pi/agent/canvas-browser/`; its daemon uses a separate directory under `XDG_RUNTIME_DIR` or the system temporary directory. The preview's settings do not change the user's normal terminal-browser profile. `HOME` is inherited, so terminal-browser's own first-run setup retains its normal behavior. Browser telemetry is disabled for previews.

Missing executables, invalid page names, unavailable Rex context and failed launches are reported through Pi notifications. Opening the index before publishing any pages is supported. The browser pane remains user-owned; ending Pi stops the Canvas server, and the user closes the preview when finished.

## Reference

The Rex launch mechanism follows [jal-co's rex-markdown bridge](https://github.com/jal-co/jalco-dotfiles/tree/main/tools/rex-markdown). Canvas opens its existing HTTP URL directly, so it does not need that bridge's macOS URL handler, Markdown link rewriting or ticket files.
