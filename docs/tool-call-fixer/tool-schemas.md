# Pi Tool Schemas

Source-verified parameter schemas for the tools the agent can emit. This is the
reference for writing repair strategies in `src/strategies/` — know exactly which
param names, types, and required/optional flags are valid so a strategy can detect
and rewrite malformed tool calls.

**Verified against:** `@earendil-works/pi-coding-agent` **0.80.3**
(`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/*.js`).

## How to read this

- **required / optional** — straight from the TypeBox schema. `Type.Optional(...)`
  means optional; everything else is required.
- **default** — defaults shown are runtime defaults described in the field's
  description text, NOT static schema defaults. None of the builtin schemas attach
  a static `default:`; the tool applies the default in `execute` when the field is
  omitted. A strategy usually does not need to synthesize defaults.
- Each tool cites its source file so the entry can be re-checked after a pi upgrade.

## Effective tool set in this setup

Two layers contribute tools:

1. **Builtin (core)** — `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`
   (the `ToolName` union in `dist/core/tools/index.d.ts`).
2. **`packages/extra-tools`** — registers `glob`, `grep`, `ls`, and (by default)
   `bash` that **shadow the builtins** on name conflict (the later-registered tool
   wins). This is why the live system prompt exposes `glob` (not `find`) and
   rewritten `grep`/`ls` descriptions. The `bash` override can be disabled via the
   `extendedBash` config item (`/config` → Extra Tools, default on; takes effect
   after `/reload`) — when off, the builtin `bash` stays in effect.

Net effective set:

| tool name | source | exposed here? |
|-----------|--------|---------------|
| `read`    | builtin | yes |
| `bash`    | `extra-tools` | **yes (replaces builtin `bash` — adds required `description`; disable via `extendedBash: false`)** |
| `edit`    | builtin | yes |
| `write`   | builtin | yes |
| `glob`    | `extra-tools` | **yes (replaces builtin `find`)** |
| `grep`    | `extra-tools` | **yes (replaces builtin `grep` — different params)** |
| `ls`      | `extra-tools` | yes (same shape as builtin) |
| `find`    | builtin | **no — shadowed by `glob`** |

> A strategy that repairs `find` → `glob` calls is worthwhile: models trained on
> stock pi emit `find`, but here `find` is not registered.

## Builtin tool schemas

### `read`

Source: `dist/core/tools/read.js` (`readSchema`). Name/label: `read`.

Params:
| field | type | required | description |
|-------|------|----------|-------------|
| `path` | string | yes | Path to the file to read (relative or absolute) |
| `offset` | number | optional | Line number to start reading from (1-indexed) |
| `limit` | number | optional | Maximum number of lines to read |

Tool description (to LLM):
> Read the contents of a file. Supports text files and images (jpg, png, gif, webp,
> bmp). Images are sent as attachments. For text files, output is truncated to 2000
> lines or 50KB (whichever is hit first). Use offset/limit for large files. When you
> need the full file, continue with offset until complete.

Strategy gotcha: the implementation also tolerates **`file_path`** as an alias for
`path` (render path reads `args?.file_path ?? args?.path`). Models that came from a
`file_path`-style schema (e.g. Claude/Anthropic conventions) may emit `file_path`;
it currently renders but the schema field is `path`, so normalizing `file_path` →
`path` is a safe, high-value repair.

### `bash` (builtin — shadowed by default)

> In this setup the **effective** `bash` is the `extra-tools` extended version below
> (unless `extendedBash` is disabled). Documented for completeness and for comparing
> param sets.

Source: `dist/core/tools/bash.js` (`bashSchema`). Name/label: `bash`.

Params:
| field | type | required | description |
|-------|------|----------|-------------|
| `command` | string | yes | Bash command to execute |
| `timeout` | number | optional | Timeout in seconds (optional, no default timeout) |

Tool description (to LLM):
> Execute a bash command in the current working directory. Returns stdout and stderr.
> Output is truncated to last 2000 lines or 50KB (whichever is hit first). If
> truncated, full output is saved to a temp file. Optionally provide a timeout in
> seconds.

### `edit`

Source: `dist/core/tools/edit.js` (`editSchema`). Name/label: `edit`.

Params:
| field | type | required | description |
|-------|------|----------|-------------|
| `path` | string | yes | Path to the file to edit (relative or absolute) |
| `edits` | array | yes | One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead. |

Each element of `edits` (`replaceEditSchema`):
| field | type | required | description |
|-------|------|----------|-------------|
| `oldText` | string | yes | Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other `edits[].oldText` in the same call. |
| `newText` | string | yes | Replacement text for this targeted edit. |

Tool description (to LLM):
> Edit a single file using exact text replacement. Every `edits[].oldText` must
> match a unique, non-overlapping region of the original file. If two changes affect
> the same block or nearby lines, merge them into one edit instead of emitting
> overlapping edits. Do not include large unchanged regions just to connect distant
> changes.

### `write`

Source: `dist/core/tools/write.js` (`writeSchema`). Name/label: `write`.

Params:
| field | type | required | description |
|-------|------|----------|-------------|
| `path` | string | yes | Path to the file to write (relative or absolute) |
| `content` | string | yes | Content to write to the file |

Tool description (to LLM):
> Write content to a file. Creates the file if it doesn't exist, overwrites if it
> does. Automatically creates parent directories.

### `grep` (builtin — shadowed)

> In this setup the **effective** `grep` is the `extra-tools` version below, not this
> one. Documented for completeness and for comparing param sets.

Source: `dist/core/tools/grep.js` (`grepSchema`). Name/label: `grep`.

Params:
| field | type | required | description |
|-------|------|----------|-------------|
| `pattern` | string | yes | Search pattern (regex or literal string) |
| `path` | string | optional | Directory or file to search (default: current directory) |
| `glob` | string | optional | Filter files by glob pattern, e.g. `*.ts` or `**/*.spec.ts` |
| `ignoreCase` | boolean | optional | Case-insensitive search (default: false) |
| `literal` | boolean | optional | Treat pattern as literal string instead of regex (default: false) |
| `context` | number | optional | Number of lines to show before and after each match (default: 0) |
| `limit` | number | optional | Maximum number of matches to return (default: 100) |

Tool description (to LLM):
> Search file contents for a pattern. Returns matching lines with file paths and
> line numbers. Respects .gitignore. Output is truncated to 100 matches or 50KB
> (whichever is hit first). Long lines are truncated to 500 chars.

### `find` (builtin — not exposed)

> Shadowed by `glob` from `extra-tools`. Documented for completeness.

Source: `dist/core/tools/find.js` (`findSchema`). Name/label: `find`.

Params:
| field | type | required | description |
|-------|------|----------|-------------|
| `pattern` | string | yes | Glob pattern to match files, e.g. `*.ts`, `**/*.json`, or `src/**/*.spec.ts` |
| `path` | string | optional | Directory to search in (default: current directory) |
| `limit` | number | optional | Maximum number of results (default: 1000) |

Tool description (to LLM):
> Search for files by glob pattern. Returns matching file paths relative to the
> search directory. Respects .gitignore. Output is truncated to 1000 results or 50KB
> (whichever is hit first).

### `ls` (builtin — shadowed, same shape as override)

Source: `dist/core/tools/ls.js` (`lsSchema`). Name/label: `ls`.

Params:
| field | type | required | description |
|-------|------|----------|-------------|
| `path` | string | optional | Directory to list (default: current directory) |
| `limit` | number | optional | Maximum number of entries to return (default: 500) |

Tool description (to LLM):
> List directory contents. Returns entries sorted alphabetically, with `/` suffix
> for directories. Includes dotfiles. Output is truncated to 500 entries or 50KB
> (whichever is hit first).

## Effective overrides (`packages/extra-tools`)

### `bash` (replaces builtin `bash` — adds required `description`)

Source: `packages/extra-tools/src/bash/index.ts` (`bashParams`). Name: `bash`, label: `bash`.
Wraps `createBashToolDefinition`: execution, truncation, temp-file persistence, and
native renderers are the builtin's; only the schema and tool description change.

Params:
| field | type | required | description |
|-------|------|----------|-------------|
| `command` | string | yes | Shell command to execute |
| `description` | string | **yes** | Brief human-readable summary of what this command does, shown in the session UI |
| `timeout` | number | optional | Timeout in seconds (optional, no default timeout) |

Strategy gotcha (high-value repair): models trained on stock pi emit bash calls
with **only** `command` (and maybe `timeout`). Against this schema those calls fail
validation — synthesize a short `description` from the command (e.g. first words of
the command line) as the repair.

### `glob` (replaces builtin `find`)

Source: `packages/extra-tools/src/glob/index.ts` (`globParams`). Name: `glob`, label: `Glob`.

Params:
| field | type | required | description |
|-------|------|----------|-------------|
| `pattern` | string | yes | The glob pattern to match files against |
| `path` | string | optional | Directory to search (relative to session cwd). Omit to use the current working directory. Do not pass the string `"undefined"`. |

Tool description (to LLM), from `glob/glob.txt`:
> - Fast file pattern matching tool that works with any codebase size
> - Supports glob patterns like `**/*.js` or `src/**/*.ts`
> - Returns matching file paths sorted by modification time
> - Use this tool when you need to find files by name patterns
> - When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead
> - You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.

Strategy gotcha: this is the effective file-find tool. Repair `find` → `glob`
(here `find` is unregistered). Note the builtin `find` had a `limit` field; the
effective `glob` has **only** `pattern` and `path` — strip stray `limit`.

### `grep` (replaces builtin `grep` — different param set)

Source: `packages/extra-tools/src/grep/index.ts` (`grepParams`). Name: `grep`, label: `Grep`.

Params:
| field | type | required | description |
|-------|------|----------|-------------|
| `pattern` | string | yes | The regex pattern to search for in file contents (ripgrep regex syntax). |
| `path` | string | optional | Directory or file to search (relative to session cwd). Defaults to the current working directory. |
| `include` | string | optional | Glob filter for paths to search (e.g. `*.ts`, `*.{ts,tsx}`). |

Tool description (to LLM), from `grep/grep.txt`:
> - Fast content search tool that works with any codebase size
> - Searches file contents using regular expressions
> - Supports full regex syntax (eg. `log.*Error`, `function\s+\w+`, etc.)
> - Filter files by pattern with the include parameter (eg. `*.js`, `*.{ts,tsx}`)
> - Returns file paths and line numbers with at least one match sorted by modification time
> - Use this tool when you need to find files containing specific patterns
> - If you need to identify/count the number of matches within files, use the Bash tool with `rg` (ripgrep) directly. Do NOT use `grep`.
> - When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead

Strategy gotchas (high-value repairs — models trained on builtin/other schemas
frequently mismatch this reduced param set):
- The builtin `grep` field **`glob`** is called **`include`** here. Rename `glob` → `include`.
- `ignoreCase`, `literal`, `context`, `limit` are **not accepted**. Case-insensitivity
  must be expressed in the regex itself (e.g. `(?i)...`); there is no boolean flag.
  Dropping these fields is the safe repair (possibly rewriting the pattern for
  `ignoreCase`).

### `ls` (replaces builtin `ls` — same shape)

Source: `packages/extra-tools/src/ls/index.ts` (`lsParams`). Name: `ls`, label: `Ls`.

Params:
| field | type | required | description |
|-------|------|----------|-------------|
| `path` | string | optional | Directory to list (default: current directory) |
| `limit` | number | optional | Maximum number of entries to return (default: 500) |

Tool description (to LLM), from `ls/ls.txt`:
> - List directory contents in the workspace (read-only)
> - Returns entry names sorted alphabetically; directories are shown with a trailing /
> - Includes dotfiles
> - Use when you need to see what files exist in a folder before using `read` or `grep`
> - Optional `limit` caps how many entries are returned (default 500)

## Other extension-provided tools (inventory)

Full schemas live in each package's `registerTool` call — re-read there when
writing a strategy that targets one of these. (Not expanded here because these are
not the builtin/high-frequency tools.)

| tool name | source |
|-----------|--------|
| `ask_user_question` | `packages/ask-user-question/src/tool.ts` |
| `create_goal`, `update_goal`, `get_goal` | `packages/goal/src/index.ts` |
| `subagent`, `subagent_status` | `packages/subagents/src/tool.ts` |
| `git_clone` | `packages/subagents/src/git-clone/index.ts` |
| `web_search` | `packages/web-tools/src/search/index.ts` |
| `web_fetch` | `packages/web-tools/src/fetch/index.ts` |
| `memory-read`, `memory-create`, `memory-update`, `memory-delete`, `memory-list`, `memory-search`, `memory-alias`, `memory-triggers`, `memory-history`, `memory-domains` | `packages/memory/src/tools/*` |
| `journal-write`, `journal-search`, `journal-read` | `packages/memory/src/tools/*` |

## Re-verification after a pi upgrade

Builtin schemas come from `node_modules` and drift on upgrade. Re-extract with:

```sh
# schemas (params + descriptions) and tool name/description for each builtin
cd node_modules/@earendil-works/pi-coding-agent/dist/core/tools
for f in bash read edit write grep find ls; do
  grep -nE "const ${f}Schema|Type\.(Object|String|Number|Boolean|Array|Optional|Union|Literal)|name:|label:|description:" "$f.js"
done

# truncation constants
grep -nE "DEFAULT_MAX_BYTES|DEFAULT_MAX_LINES|GREP_MAX_LINE_LENGTH" truncate.js
# per-tool limits
grep -nE "const DEFAULT_LIMIT" bash.js read.js grep.js find.js ls.js

# effective overrides
cd ../../../../../../../packages/extra-tools/src
for d in bash glob grep ls; do grep -nE "Type\.(Object|String|Number|Boolean|Optional)|name:|label:" "$d/index.ts"; cat "$d/$d.txt" 2>/dev/null; done
```

Then diff against this file and update the "Verified against" version line.
