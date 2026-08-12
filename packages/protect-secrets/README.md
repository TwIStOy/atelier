# protect-secrets

Blocks tools from reading or printing secrets. The extension hooks `tool_call` and
denies access to protected paths before the tool runs:

- **read / glob / grep** — any call whose `path`/`filePath` is a protected path, or
  lives under one, is blocked.
- **bash** — the command is parsed into an AST (via `unbash`) and analyzed, not just
  string-matched. A command is blocked when secret content could reach stdout:
  - file-reading commands (`cat`, `head`, `grep`, `sed`, `source`, …) referencing a
    protected path without a stdout redirect;
  - pipelines that read a protected path and whose final stage is not redirected;
  - `echo`/`printf` arguments that expand (e.g. `$(cat …)`) to secret content;
  - unparseable commands that still mention a protected path (fail closed).
- Commands that handle secrets without printing them are allowed: redirects to a
  file (`cat secret > /tmp/out`), variable assignments (`KEY=$(cat secret)`),
  passing secrets to subprocesses (`curl -H "Auth: $(cat secret)" …`), and
  non-reading commands (`ls`, `stat`, `cp`, `chmod`, …).

`/run/agenix` is always protected. The block reason names the protected location
and states that its contents are secrets.

## Project-local configuration

Add extra protected paths per project at
`<project>/.pi/extensions/protect-secrets/config.json`:

```json
{
  "protectedPaths": ["secrets/", "~/vault/keys", "/etc/myapp/tls"]
}
```

`protectedPaths` entries are normalized as follows:

- Absolute paths are used as-is.
- `~/…` expands to the current user's home directory.
- Relative paths resolve against the project root (the session cwd).
- Trailing slashes and `.`/`..` segments are normalized away.

Notes:

- Entries are treated as prefixes: protecting `secrets/` also protects everything
  under it. An entry may name a single file.
- The built-in `/run/agenix` protection cannot be removed; the config only adds
  paths.
- The file is re-read when it changes (cached by mtime + size), so edits take
  effect without restarting the session.
- A malformed config (invalid JSON, wrong types) disables the extra paths and
  surfaces a warning notification on session start.
