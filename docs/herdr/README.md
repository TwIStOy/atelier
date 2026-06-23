# herdr — Native Pane/Tab/Workspace Orchestration for pi

> Reference notes learned from [`@ogulcancelik/pi-herdr`](https://github.com/ogulcancelik/pi-extensions/blob/main/packages/pi-herdr/README.md).
> This documents how an agent interacts with [herdr](https://github.com/ogulcancelik/herdr) from inside pi.

## 1. What it is

`pi-herdr` is a pi extension that exposes a single **`herdr` tool** to the agent. It replaces the most common `pi-tmux` workflow with herdr's native CLI wrappers, so the agent can:

- Run commands in existing panes, read their output, wait for readiness.
- Coordinate with other agents running in sibling panes.
- Organize work across tabs and workspaces.
- Do all of the above **without** falling back to manual tmux choreography.

Underlying herdr CLI calls the extension wraps:

```
herdr workspace ...      herdr tab ...
herdr pane split         herdr pane run
herdr pane read          herdr wait output
herdr wait agent-status  herdr pane close
```

## 2. Requirements & activation

| Requirement | Detail |
| --- | --- |
| pi version | v0.40+ |
| `herdr` | must be installed |
| Runtime | pi **must be running inside a herdr pane** |

The extension is **inert outside herdr**: it returns early unless **both** `HERDR_ENV` exists and `HERDR_PANE_ID` is present. In that case the `herdr` tool is not registered at all.

## 3. Tool actions at a glance

| Action | Purpose |
| --- | --- |
| `list` | List panes in the current herdr workspace |
| `workspace_list` / `workspace_create` / `workspace_focus` | List / create / focus a workspace |
| `tab_list` / `tab_create` / `tab_focus` | List / create / focus a tab |
| `focus` | Focus a workspace, a tab, or **the tab containing a pane** |
| `pane_split` | Split an existing pane, optionally aliasing the new one |
| `run` | Submit a line **atomically with Enter** in an existing pane |
| `read` | Read output from a pane |
| `watch` | Wait until pane output matches text or regex |
| `wait_agent` | Wait until pane(s) running recognized coding agents reach target status(es) |
| `send` | Send raw text/keys **without** implicit Enter |
| `stop` | Close a pane |

## 4. Core concept: pane identity & aliases

Pane actions target **pane identity**, addressed in two ways:

- **Friendly aliases** — short names you choose, e.g. `server`, `tests`, `reviewer`.
- **Real herdr pane ids** — returned by `list`/create results, e.g. `w64eca6cb07ad62-2`.

Alias state is stored in tool-result details and **reconstructed on session load and branch changes**. A real pane id from any herdr response can be used directly (even outside the alias map) as long as it belongs to the agent's current workspace.

**Stale alias handling:** if an alias no longer points to a live pane, the extension removes it and returns an error.

## 5. Defaults & behavior rules

- **Current focus is preserved by default.** Creation flows stay in the current UI context unless `focus: true` is passed explicitly.
- `pane_split`:
  - Creates a **right sibling** of the agent's own pane by default.
  - Accepts optional `pane` (an existing pane to split instead), `direction`, `newPane` (alias for the result), `cwd`, `focus`.
  - Returns the created pane.
- `workspace_create` / `tab_create`:
  - Accept `label`.
  - Use herdr's returned `root_pane` when available, with a pane-list fallback for older herdr versions.
- `run`:
  - The **default** way to submit a line or prompt — sends text + Enter atomically.
  - **Only** targets an existing pane alias/id. It **never** creates or restarts panes.
- `read` / `watch` output modes: `visible`, `recent`, `recent-unwrapped`.
- `watch` / `wait_agent` **forward pi's abort signal** — pressing **Escape** cancels the wait.

## 6. Agent status semantics (`wait_agent`)

> `wait_agent` is **only** for panes running a recognized coding agent. Do **not** use it for normal shell commands, test runners, build processes, or dev servers — use `watch` for output conditions and `read` for inspection instead.

Herdr agent statuses:

| Status | Meaning |
| --- | --- |
| `working` | The agent is actively processing |
| `blocked` | The agent needs user input or approval |
| `done` | The agent finished in a background pane **and you have not looked at it yet** |
| `idle` | The agent finished **and the pane has already been seen** |
| `unknown` | No recognized agent is detected |

Key workflow tips:

- If you start another agent in a background pane and wait for completion, **usually wait for `done`**.
- If the pane is focused while the agent finishes, expect **`idle`** instead.
- Do **not** treat `blocked` as generic startup readiness.

Multi-pane waits: `wait_agent` accepts either `pane`/`status` (single) or `panes`/`statuses` (multi), controlled by `mode: "all"` or `mode: "any"`.

## 7. `run` vs `send`

| Need | Use |
| --- | --- |
| Text **+ Enter** as one atomic action | `run` |
| Low-level raw input, **no** Enter | `send` (combine with `Enter` yourself, or just use `run`) |

`run` is preferred because it submits the line atomically.

## 8. Recipe: start another pi cleanly

A fresh agent in another pane = create a tab/workspace root pane (or split an existing one), **alias it**, then `run` in that existing pane.

```jsonc
{ "action": "tab_create", "label": "review", "pane": "reviewer" }
```
```jsonc
{ "action": "run", "pane": "reviewer", "command": "pi --no-session --model openai-codex/gpt-5.4-mini" }
```

> If model choice matters and the user has not specified one, **ask** which model/provider to use.

## 9. Common workflows (examples)

**Split the agent's own pane right and alias the sibling:**
```jsonc
{ "action": "pane_split", "newPane": "reviewer" }
```

**Split an explicit existing pane:**
```jsonc
{ "action": "pane_split", "pane": "server", "direction": "right", "newPane": "reviewer" }
```

**Create a tab, alias its root pane, run a dev server, wait for readiness, read logs:**
```jsonc
{ "action": "tab_create", "label": "server", "pane": "server" }
{ "action": "run", "pane": "server", "command": "bun run dev" }
{ "action": "watch", "pane": "server", "match": "ready|listening on", "regex": true, "timeout": 30000 }
{ "action": "read", "pane": "server", "source": "recent-unwrapped", "lines": 40 }
```

**Wait for another agent to finish (UI sense):**
```jsonc
{ "action": "wait_agent", "pane": "reviewer", "status": "done", "timeout": 300000 }
```

**Wait until a whole set of panes has settled:**
```jsonc
{ "action": "wait_agent", "panes": ["pi-00f", "pi-010", "pi-016"], "statuses": ["idle", "done"], "mode": "all", "timeout": 300000 }
```

**Focus the tab containing a known pane id:**
```jsonc
{ "action": "focus", "pane": "w64eca6cb07ad62-2" }
```

**List workspaces / tabs:**
```jsonc
{ "action": "workspace_list" }
{ "action": "tab_list", "workspace": "1" }
```

## 10. Notes & gotchas for agents

- `pane_split`, `run`, `read`, `watch`, `wait_agent`, `send`, and `stop` target **panes only**. Never pass tab ids to these actions.
- Use `run`, never `send` + manual `Enter`, when you want text plus Enter.
- A real pane id from `list`/another response works directly in `run`/`read`/`watch`/`wait_agent`/`send`/`stop`/`focus`, as long as it belongs to the current workspace.
- Herdr does **not** currently expose direct pane focus — `focus` with a pane id focuses that pane's **tab**.
- `tab_create`/`workspace_create` preserve focus unless `focus: true`.
- If a `run`/`read`/etc. alias is stale, the extension removes the alias and returns an error (don't retry blindly — re-`list` or re-create the pane first).
